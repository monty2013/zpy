/*
 * Webserver implementation, wrapped around a generic game engine.
 */

import {Engine} from 'protocol/engine.ts'
import * as P from 'protocol/protocol.ts'
import * as Session from 'server/session.ts'

import * as WebSocket from 'ws'
import * as Http from 'http'
import assert from 'assert'
import * as Uuid from 'uuid'

export type GameId = string;
export type Principal = Session.Id;

interface Client {
  principal: Principal;
  user: P.User | null;
  sync: boolean;
  socket: WebSocket;
};

// the server-side protocol monkey
//
// this manages the network communication w/ the clients and shovels updates
// into the game engine as appropriate.
class Game<
  Config,
  Intent,
  State,
  Action,
  ClientState,
  Effect,
  UpdateError,
  Eng extends Engine<
    Config,
    Intent,
    State,
    Action,
    ClientState,
    Effect,
    UpdateError
  >
> {
  engine: Eng;
  config: Config;
  owner: Principal;
  state: State;
  clients: Client[] = [];
  next_id: number = 0;

  // start a new game w/ no players; the principal identifies the player who
  // will be marked as a host once they join
  constructor(engine: Eng, owner: Principal, config: Config) {
    this.engine = engine;
    this.config = config;
    this.owner = owner;
    this.state = this.engine.init(config);
  }

  // try to apply the given action originating with a particular client and
  // transaction. the provided source and transaction id are used to mark the
  // update message as a reply to the appropriate client.
  //
  // if `source` is set, `tx` must also be set. if neither is set, the action
  // originated from the server.
  //
  // a return value of null indicates success; if the engine returns an error
  // on `apply`, it is forward as the return value
  process_update(
    act: Action | P.ProtocolAction,
    source: null | Client,
    tx: null | P.TxId
  ): UpdateError | null {
    let newstate = this.engine.apply(this.state, act);
    if (this.engine.tUpdateError.is(newstate)) return newstate;

    this.state = newstate;

    for (let client of this.clients) {
      if (!client.sync) continue;

      let eff = P.tProtocolAction.is(act)
        ? act
        : this.engine.redact_action(this.state, act, client.user);

      let for_tx = client === source ? tx : null;

      client.socket.send(JSON.stringify({
        verb: "update",
        tx: for_tx,
        effect: eff,
      }));
    }
    return null;
  }

  // process a hello message from a client. this marks them as present but not
  // yet synchronized; they won't receive updates until they ask for a reset
  hello(client: Client, nick: string): void {
    let user = {
      id: this.next_id++,
      nick: nick,
    };

    let res = this.process_update({
      verb: 'user:join',
      who: user,
    }, client, null);
    assert(res === null);

    client.user = user;
    client.socket.send(JSON.stringify({
      verb: "hello",
      you: user,
    }));
  }

  // process an update request from a client. the response will be marked w/ the
  // transaction id provided here; either as an update messsage after we handle
  // the update or as an update-reject message
  update(client: Client, tx: P.TxId, int: Intent) {
    let bail = (ue: UpdateError) => client.socket.send(JSON.stringify({
      verb: "update-reject",
      tx: tx,
      reason: act,
    }));

    let act = this.engine.listen(this.state, int, client.user);
    if (this.engine.tUpdateError.is(act)) {
      return bail(act);
    }

    let err = this.process_update(act, client, tx);
    if (err !== null) {
      return bail(err);
    }
  }

  // process a reset request from a client; we simply need to forward that
  // client's state
  reset(client: Client) {
    let cs = this.engine.redact(this.state, client.user);
    client.sync = true;
    client.socket.send(JSON.stringify({
      verb: "reset",
      state: cs,
      who: this.clients.map(cli => cli.user),
    }));
  }

  // after we are finished w/ a client session, close their socket and remove
  // them from the list of clients
  //
  // TODO this should also be responsible for processing leaves if necessary
  dispose(client: Client) {
    client.sync = false;
    client.socket.close();
    this.clients.splice(this.clients.indexOf(client));
  }

  // process a bye request from a client. simply reply 'bye' and disconnect
  bye(client: Client) {
    client.socket.send(JSON.stringify({
      verb: "bye"
    }));
    this.dispose(client);
  }

  // kick a naughty client by sending them 'bye' and disconnecting
  kick(client: Client, reason: string) {
    console.log("kick: " + reason);
    this.bye(client)
  }

  // handle a new connection for the given session and websocket; the game
  // takes ownership of the websocket at this point
  connect(session: Session.Session, sock: WebSocket) {
    let client: Client = {
      principal: session.id,
      user: null,
      sync: false,
      socket: sock,
    };

    this.clients.push(client);

    sock.on('message', (data: string) => {
      let d = JSON.parse(data);
      let tClientMessage = P.tClientMessage(this.engine.tIntent);

      if (tClientMessage.is(d)) {
        switch (d.verb) {
          case "req:bye": this.bye(client); break;
          case "req:hello": this.hello(client, d.nick); break;
          case "req:reset": this.reset(client); break
          case "req:update": this.update(client, d.tx, d.intent); break;
        }
      } else {
        this.kick(client, "invalid msg");
      }
    })
  }
}

// a websocket server that can handle multiple games for a given engine
export class GameServer<
  Config,
  Intent,
  State,
  Action,
  ClientState,
  Effect,
  UpdateError,
  Eng extends Engine<
    Config,
    Intent,
    State,
    Action,
    ClientState,
    Effect,
    UpdateError
  >
> {
  engine: Eng;
  ws: WebSocket.Server;
  games: Record<
    GameId,
    Game<Config, Intent, State, Action, ClientState, Effect, UpdateError, Eng>
  > = {};

  // attach to the provided http server to handle upgrade requests.
  constructor(engine: Eng, server: Http.Server, url_pref: string) {
    this.engine = engine;
    this.ws = new WebSocket.Server({noServer: true});

    server.on('upgrade', async (req: Http.IncomingMessage, sock, head) => {
      let bail = (reason: string) => {
        console.log(reason)
        sock.write('HTTP/1.1 400 Bad Request\r\n' +
                   'X-Reason: ' + reason + '\r\n');
        sock.destroy();
        return;
      };

      // is the url cromulent
      let matches = req.url.match(`^\/${url_pref}\/([^\\\/]*)\/$`);
      if (matches === null) {
        return bail("invalid uri");
      }

      // is the game a real thing
      let game_id = matches[1];
      if (!(game_id in this.games)) {
        return bail("no such game: " + game_id);
      }
      let game = this.games[game_id];

      // is this someone we know about
      let id: string | null = null;
      let token: string | null = null;

      for (let c of req.headers.cookie.split(';')) {
        // sketchy cookie parsing let's gooooo
        let matches = c.trim().match(/^([^=]*)=([^=]*)$/);
        if (matches === null || matches.length !== 3) {
          continue;
        } else if (matches[1] === "id") {
          id = matches[2];
        } else if (matches[1] === "token") {
          token = matches[2];
        }
      }

      if (id === null || token === null) {
        return bail("no principal provided (log in first)");
      }

      let session = Session.get(id);
      if (session === null) {
        return bail("no session " + id);
      }

      if (token !== session.token) {
        return bail("invalid token: " + token);
      }

      this.ws.handleUpgrade(req, sock, head, async (ws: WebSocket) => {
        this.ws.emit('connection', ws, req, game, session);
      });
    });

    this.ws.on('connection', (
      ws: WebSocket,
      req: Http.IncomingMessage,
      game: Game<Config, Intent, State, Action,
                 ClientState, Effect, UpdateError, Eng>,
      session: Session.Session
    ) => {
      return game.connect(session, ws);
    });
  }

  // make a new room for a game with the given owner. returns the game id.
  public begin_game(
    cfg: Config,
    owner: Principal,
  ): GameId {
    let id = Uuid.v4();
    this.games[id] = new Game(this.engine, owner, cfg);
    return id;
  }
};
