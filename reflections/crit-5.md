# Crit 5 Reflection

## What was the breakthrough that moved the work forward?

The breakthrough was realising that a game can be technically correct but still not work well for a real player.

For a long time, the automated tests were green. The rules worked, the moth could reach the flower, hazards could cause a loss, and the five stages could be completed. But when I actually played the game, I kept finding problems that the tests could not show. The moth and hazards were hard to recognise, the moth sometimes circled around the light, the hazard attraction felt unfair, the story was difficult to understand, and some important objects became hard to see after the backgrounds became more detailed.

The biggest improvements came from repeatedly playing the game, noticing what felt confusing or frustrating, and then changing the design. This changed the project from a working mechanic into something that felt much more like a complete game.

## What did this work change about who I want to be as a software developer?

This work made me want to become a developer who uses automated tests as evidence, but not as the final judgement.

Tests are very useful for checking rules and preventing regressions, but they cannot fully tell me whether an interaction is clear, fair, enjoyable, or meaningful. I want to keep testing my software technically, while also spending more time actually using what I build and seeing it from a first-time user's point of view.

For me, “all tests pass” should mean the system is ready to be experienced, not that the design is finished.