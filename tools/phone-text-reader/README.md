# Pocket Reader — a text-to-speech reader for your phone

One HTML file, no server, no account. Open `index.html` in a phone browser
(or the published artifact link), paste or open a `.txt` file, and the
phone's built-in speech engine reads it aloud while the current sentence
is highlighted.

## How it works (the three parts of any web page)

| Part | What it is | Where in the file |
|------|-----------|-------------------|
| HTML | The *structure*: header, reading sheet, play bar, two drawers | the tags between `<header>` and `</section>` |
| CSS  | The *look*: colours, fonts, spacing, light/dark theme | inside `<style>` |
| JS   | The *behaviour*: splitting text into sentences, the speaking loop, buttons | inside `<script>` |

The program follows one pattern worth learning: **state → render → events**.
A small object holds the facts (what text, which sentence, playing or not).
`render()` draws the screen from that state. Buttons and the speech engine
change the state and call `render()` again. Nothing else touches the screen.

## Why it speaks one sentence at a time

Phone browsers stop long speech mid-way (a long-standing bug), and a
sentence-sized unit is what lets you tap any sentence to jump there and
see the highlight move.

## Not part of the trading system

This lives in `tools/` because it is a standalone utility page. It shares
no code with the backtester and is not subject to the spec's build order.
