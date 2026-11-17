# Rules of 8-ball

The game follows the world-standardised (WPA) rules, with one simplification: only the 8 is called. The code is
[src/sim/rules.ts](../src/sim/rules.ts), tested in [tests/rules.test.ts](../tests/rules.test.ts).

## The break

- The breaker places the cue ball anywhere behind the head string (the line a quarter of the way up the table).
- **Legal break:** a ball is potted, or at least four object balls reach a cushion. Otherwise the balls are
  racked again and the other player breaks.
- **Scratch on the break** (cue ball potted): foul. The other player has ball in hand behind the head string.
- **The 8 down on the break** is not a loss: it goes back on the foot spot.
- After the break the table is **open**, whatever was potted.

## Groups

- On an open table, any ball may be hit first except the 8.
- The first ball potted on a legal shot after the break decides: that player takes its group (solids 1-7 or
  stripes 9-15), the other player the other group.

## A legal shot

The cue ball must first hit a ball of the shooter's group (or the 8, once the group is cleared). Then a ball must
be potted, or some ball (the cue ball included) must reach a cushion.

The shooter keeps the table after potting a ball of their own group on a legal shot.

## Fouls

- The cue ball is potted (scratch).
- No ball is hit, or the wrong ball is hit first.
- Nothing is potted and no ball reaches a cushion after the contact.

After a foul the other player has **ball in hand**: the cue ball may be placed anywhere on the table.

## The 8

- With the group cleared, the shooter plays the 8 and calls a pocket for it. The game suggests the pocket the
  guide shows the 8 going to; tap another pocket to change it.
- **Win:** the 8 goes into the called pocket on a legal shot.
- **Loss:** the 8 goes down before the group is cleared, into another pocket, or on a foul (a scratch, or the
  wrong ball hit first).
