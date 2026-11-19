# agi.js
Adventure Game Interpreter (AGI) for Sierra's classic 80's adventure games written for the browser environment.

This fork aims to be a complete, faithful AGI v2 interpreter (King's Quest 1–3, Space Quest 1–2,
Police Quest 1, Leisure Suit Larry 1, …), including the original typed text input.

## Running

Requires Node.js 20.19 or newer.

```sh
npm install
npm run dev        # development server with live reload: http://localhost:3000
```

Production build:

```sh
npm run build      # minified build in dist/
npm start          # serves dist/ (and games/) at http://localhost:3000
```

`npm run typecheck` type-checks the files that have `// @ts-check` at the top.

## Adding games

Game files are not included: the original Sierra games are copyrighted. Put the games you own in the
`games/` folder in the project root. That folder is git-ignored, so the files are never committed.

Each game goes in its own folder, with the original files directly inside it:

```
games/
  sq1/        LOGDIR  PICDIR  VIEWDIR  SNDDIR  VOL.0  VOL.1 …  WORDS.TOK  OBJECT
  lsl1/       …
  kq1.zip     a ZIP with the same files also works
```

The page lists the games it finds in a dropdown; picking one loads and starts it. Picking another
game reloads the page, because a running game cannot be unloaded. You can also pick one in the URL:

- `?game=sq1` loads and starts `games/sq1/` (or `games/sq1.zip`).
- `#<url>` loads a ZIP from any URL, for example `#/demos/archive1.zip`.

Only AGI v2 games work for now. v3 games (King's Quest 4, Gold Rush, Manhunter) show up in the list
but are disabled.

The development and preview servers serve `games/` themselves; the folder is never copied into
`dist/`. To host the build elsewhere, serve a `games/` folder next to it, including a
`games/index.json` like the one at http://localhost:3000/games/index.json, or use `#<url>` links.

## How it works

- With TTS turned on, all text dialog will be spoken aloud
- Load ZIP files with AGI content and it will start playing

## Controls

- Pick a game from the dropdown; it loads and starts right away
- Click the screen to pause or resume

- Menus now work (virtual program controller keys are supported, (ex: 21 for "About" menu item)

## Background

This is a project that aims to recreate one of the most beautiful game engines ever created.
Sierra On-Line's Adventure Game Interpreter was created in the mid 80's by Sierra employees 
Jeff Stephenson and Chris Iden and quickly became the cornerstone on which many of Sierra's 
early titles would be based. AGI was built around the concept of a virtual machine that made 
it fairly easy for Sierra to port their games to multiple platforms.

The virtual machine was based around an in-house developed C-like programming language called "Logic".
When the programmer compiled a Logic file, the compiler produced an 8-bit "opcode" for each statement.
In the interpreter, each opcode was defined in a jump table which simply pointed to an assembler
subroutine. This made the system very fast and ridiculously elegant, because the logic itself never
needed to be recompiled no matter what the target platform was. It was also fairly easy to extend
the system which can be witnessed by the numerous versions of AGI interpreters produced by Sierra.

By the time these games were created, storage was limited and expensive. To reduce asset size,
the game's background images were defined as vector graphics instead of full raster images. 
When the game needed to display a new background image, it was drawn into a buffer and 
finally blitted to the screen. This is interesting because this theoretically allows us to rescale 
the images to any resolution. It's also interesting from an artistic perspective as it allows us to 
trace how the artist originally drawed the pictures, command by command. 

Another interesting feature of the engine was its ability render a room with a pseudo-perspective.
The engine divided the screen into 15 sections, called priority bands. This was basically a
kind of low-resolution Z-buffer. All background drawing commands were drawn both with a visual color
and a priority value, so everytime the engine had to draw an animated object, each of its pixels were
compared against the backgrounds pixel's priority value to decide if the pixel was to be drawn or not.
All control-lines and boundaries where the player could not go was also drawn into this priority buffer.

## AGI command references

- Open http://agi.sierrahelp.com/AGIStudioHelp/TOC.html and then run this to show all entries:
```
Array.from(document.querySelectorAll('dt')).forEach(v=>v.click())
```

- https://wiki.scummvm.org/index.php/AGI/Specifications/Resources#The_else_command_and_more_on_brackets
```
/usr/local/Cellar/qt/5.15.0/bin/qmake agistudio.pro -o Makefile
```

## Game Specific References

AGI homebrew games on archive.org:
- https://archive.org/search.php?query=%28AGI%29&and[]=mediatype%3A%22software%22
- http://www.thealmightyguru.com/Wiki/index.php?title=Sierra_AGI_Demos

## AGI Architecture

- https://gamicus.gamepedia.com/Adventure_Game_Interpreter
- http://allowe.com/games/larry/inside-stories/sierra-history.html
- http://agiwiki.sierrahelp.com/images/f/f5/AGDS.pdf
- Main reference: http://www.agidev.com/articles/agispec/agispecs.html#toc10
- http://agiwiki.sierrahelp.com/index.php?title=Actions,_Tests_and_Flags_in_the_Adventure_Game_Interpreter#Flags

Logic command implementations from another engine
- https://github.com/huguesv/AgiPlayer/blob/ced9361b910e6ad391c86380c6e17c73ea01064f/src/Woohoo.Agi.Interpreter/Interpreter/AgiInterpreter.Kernel.cs
- https://github.com/huguesv/AgiPlayer/blob/ced9361b910e6ad391c86380c6e17c73ea01064f/src/Woohoo.Agi.Interpreter/Interpreter/AgiInterpreter.cs

- LOGICs are the AGI virtual machine code for the game, tells the engine what to do
    - Core aspect of the engine
- PICTURES are background images with visual (displayed as is to user) and priority images (act as primitive z-buffer for clipping and bounding of game objects)
- VIEWs are animations collections that sit on top of the PICs; e.g. ego, opening doors, portals, etc.
  - LOOPs are individual sequences of animations
  - CELs are individual frames within a LOOP
- SOUNDs are just that, both sound effects along with music
- [WORDS.TOK](https://wiki.scummvm.org/index.php/AGIWiki/WORDS.TOK) contains words recognized by the game

## AGI details discovered

No support for F11, F12 keys since the AGI engine was made to target IBM PCjrs. Their keyboards only
have F1 - F10 keys.

![](images/ibm-pcjr-kb.png)

- http://www.lainenooney.com/research.html

## SCI Architecture
- https://gamicus.gamepedia.com/Sierra_Creative_Interpreter
- https://github.com/OmerMor/SCI16
- http://sci.sierrahelp.com/Documentation/SCISpecifications/08-ResourceFiles.html
- Design documents, etc
- http://sci.sierrahelp.com/Documentation/Documentation.html

## Shivers 2 RE

- https://wiki.multimedia.cx/index.php/Sierra_Audio (SOL file format)

## Use Emscripten to compile the logic code because JS does not support GOTOs

- https://emscripten.org/docs/getting_started/downloads.html
- https://github.com/emscripten-core/emscripten/issues/9036#issuecomment-532092743
  - `open /Applications/Python\ 3.8/Install\ Certificates.command`

## Credits

- [r1sc/agi.js](https://github.com/r1sc/agi.js): the original browser AGI interpreter.
- [jsyang/agi](https://github.com/jsyang/agi): the fork this one is based on, with many game fixes,
  menus, save/restore, sound and text-to-speech.
- [NAGI](https://github.com/sonneveld/nagi): an AGI interpreter reconstructed from Sierra's original,
  used as the reference for how AGI behaves. Code ported from NAGI is marked as such in the source.
- Everyone who documented AGI: the AGI Specifications, AGIWiki and the ScummVM AGI engine.
- AGI and the games themselves are by Sierra On-Line.

## License

GPL v3, see [LICENSE](LICENSE). Code ported from NAGI is also covered by NAGI's X11 license,
see [licenses/NAGI-LICENSE.txt](licenses/NAGI-LICENSE.txt).
