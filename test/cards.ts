import {
  Suit, Rank, TrumpMeta, CardBase, Card, CardPile
} from 'lib/cards.ts';

import {expect} from 'chai';

describe('Card', () => {
  it('canonicalizes correctly', () => {
    let card;
    let tr = new TrumpMeta(Suit.HEARTS, 7);

    card = new Card(Suit.CLUBS, Rank.K, tr);
    expect(card.v_suit).to.equal(Suit.CLUBS);
    expect(card.v_rank).to.equal(Rank.K);

    card = new Card(Suit.HEARTS, Rank.K, tr);
    expect(card.v_suit).to.equal(Suit.TRUMP);
    expect(card.v_rank).to.equal(Rank.K);

    card = new Card(Suit.CLUBS, 7, tr);
    expect(card.v_suit).to.equal(Suit.TRUMP);
    expect(card.v_rank).to.equal(Rank.N_off);

    card = new Card(Suit.HEARTS, 7, tr);
    expect(card.v_suit).to.equal(Suit.TRUMP);
    expect(card.v_rank).to.equal(Rank.N_on);

    card = new Card(Suit.TRUMP, Rank.B, tr);
    expect(card.v_suit).to.equal(Suit.TRUMP);
    expect(card.v_rank).to.equal(Rank.B);
  });

  it('canonicalizes jokers', () => {
    let card;
    let tr = new TrumpMeta(Suit.TRUMP, Rank.B);

    card = new Card(Suit.CLUBS, Rank.K, tr);
    expect(card.v_suit).to.equal(Suit.CLUBS);
    expect(card.v_rank).to.equal(Rank.K);

    card = new Card(Suit.TRUMP, Rank.S, tr);
    expect(card.v_suit).to.equal(Suit.TRUMP);
    expect(card.v_rank).to.equal(Rank.S);
  });

  it('compares correctly', () => {
    let tr = new TrumpMeta(Suit.HEARTS, 7);

    let small = new Card(Suit.SPADES, 6, tr);
    let large = new Card(Suit.SPADES, Rank.A, tr);
    let off   = new Card(Suit.CLUBS, Rank.A, tr);
    let trump = new Card(Suit.HEARTS, 6, tr);

    expect(Card.compare(small, large)).to.equal(-1);
    expect(Card.compare(small, small)).to.equal(0);
    expect(Card.compare(large, small)).to.equal(1);

    expect(Card.compare(small, off)).to.be.null;
    expect(Card.compare(off, small)).to.be.null;

    expect(Card.compare(off, trump)).to.equal(-1);
    expect(Card.compare(trump, trump)).to.equal(0);
    expect(Card.compare(trump, off)).to.equal(1);
  });
});

describe('CardPile', () => {
  it ('works as advertised', () => {
    let tr = new TrumpMeta(Suit.SPADES, 7);

    let pile = new CardPile([
      new CardBase(Suit.CLUBS, Rank.K),
      new CardBase(Suit.CLUBS, Rank.K),
      new CardBase(Suit.CLUBS, 3),
      new CardBase(Suit.CLUBS, 7),
      new CardBase(Suit.CLUBS, 7),
      new CardBase(Suit.DIAMONDS, Rank.J),
      new CardBase(Suit.DIAMONDS, Rank.A),
      new CardBase(Suit.DIAMONDS, 2),
      new CardBase(Suit.SPADES, 2),
      new CardBase(Suit.SPADES, 2),
      new CardBase(Suit.SPADES, Rank.A),
      new CardBase(Suit.DIAMONDS, 7),
      new CardBase(Suit.DIAMONDS, 7),
      new CardBase(Suit.DIAMONDS, 7),
      new CardBase(Suit.HEARTS, 2),
      new CardBase(Suit.HEARTS, 10),
      new CardBase(Suit.HEARTS, 9),
      new CardBase(Suit.HEARTS, Rank.A),
      new CardBase(Suit.SPADES, 7),
      new CardBase(Suit.HEARTS, 8),
      new CardBase(Suit.TRUMP, Rank.B),
      new CardBase(Suit.TRUMP, Rank.S),
      new CardBase(Suit.TRUMP, Rank.B),
    ], tr);

    expect('' + pile).to.equal(`
♣[3]: 3♣ K♣ K♣
♦[3]: 2♦ J♦ A♦
♥[5]: 2♥ 8♥ 9♥ 10♥ A♥
☉[12]: 2♠ 2♠ A♠ 7♣ 7♣ 7♦ 7♦ 7♦ 7♠ w☉ W☉ W☉
`.trim()
    );

    let card = new Card(Suit.CLUBS, Rank.K, tr);
    expect(pile.count(card)).to.equal(2);
    pile.remove(card, 2);
    expect(pile.count(card)).to.equal(0);
    pile.insert(card, 3);
    expect(pile.count(card)).to.equal(3);

    expect('' + pile).to.equal(`
♣[4]: 3♣ K♣ K♣ K♣
♦[3]: 2♦ J♦ A♦
♥[5]: 2♥ 8♥ 9♥ 10♥ A♥
☉[12]: 2♠ 2♠ A♠ 7♣ 7♣ 7♦ 7♦ 7♦ 7♠ w☉ W☉ W☉
`.trim()
    );

    expect(pile.count_suit(Suit.CLUBS)).to.equal(4);
    expect(pile.count_suit(Suit.DIAMONDS)).to.equal(3);
    expect(pile.count_suit(Suit.SPADES)).to.equal(0);
    expect(pile.count_suit(Suit.HEARTS)).to.equal(5);
    expect(pile.count_suit(Suit.TRUMP)).to.equal(12);

    let subpile = new CardPile([
      new CardBase(Suit.CLUBS, Rank.K),
      new CardBase(Suit.CLUBS, 7),
      new CardBase(Suit.DIAMONDS, Rank.J),
      new CardBase(Suit.DIAMONDS, 7),
      new CardBase(Suit.DIAMONDS, 7),
      new CardBase(Suit.DIAMONDS, 7),
      new CardBase(Suit.HEARTS, 2),
      new CardBase(Suit.HEARTS, 10),
      new CardBase(Suit.TRUMP, Rank.S),
      new CardBase(Suit.TRUMP, Rank.B),
    ], tr);

    expect(pile.contains(subpile.gen_counts())).to.be.true;

    tr = new TrumpMeta(Suit.DIAMONDS, Rank.A);
    pile.rehash(tr);

    expect('' + pile).to.equal(`
♣[6]: 3♣ 7♣ 7♣ K♣ K♣ K♣
♠[3]: 2♠ 2♠ 7♠
♥[4]: 2♥ 8♥ 9♥ 10♥
☉[11]: 2♦ 7♦ 7♦ 7♦ J♦ A♠ A♥ A♦ w☉ W☉ W☉
`.trim()
    );

    tr = new TrumpMeta(Suit.TRUMP, Rank.B);
    pile.rehash(tr);

    expect('' + pile).to.equal(`
♣[6]: 3♣ 7♣ 7♣ K♣ K♣ K♣
♦[6]: 2♦ 7♦ 7♦ 7♦ J♦ A♦
♠[4]: 2♠ 2♠ 7♠ A♠
♥[5]: 2♥ 8♥ 9♥ 10♥ A♥
☉[3]: w☉ W☉ W☉
`.trim()
    );

    tr = new TrumpMeta(Suit.SPADES, 7);
    pile.rehash(tr);

    expect('' + pile).to.equal(`
♣[4]: 3♣ K♣ K♣ K♣
♦[3]: 2♦ J♦ A♦
♥[5]: 2♥ 8♥ 9♥ 10♥ A♥
☉[12]: 2♠ 2♠ A♠ 7♣ 7♣ 7♦ 7♦ 7♦ 7♠ w☉ W☉ W☉
`.trim()
    );

    tr = new TrumpMeta(Suit.CLUBS, 7);
    pile.rehash(tr);

    expect('' + pile).to.equal(`
♦[3]: 2♦ J♦ A♦
♠[3]: 2♠ 2♠ A♠
♥[5]: 2♥ 8♥ 9♥ 10♥ A♥
☉[13]: 3♣ K♣ K♣ K♣ 7♦ 7♦ 7♦ 7♠ 7♣ 7♣ w☉ W☉ W☉
`.trim()
    );
  });
});
