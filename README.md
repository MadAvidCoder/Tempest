# RustTempest

https://github.com/user-attachments/assets/9b6ccc94-966c-4c53-9bf5-934ba19441c4

RustTempest is a vscode extension that sends code to the [Rust Playround](https://play.rust-lang.org/) from an open VSCode workspace. This means I can run rust code without installing rustup/rustc, making it good for when you can't install and run that. It has some limitations, including that rust playground only supports seelected libraries from crates.io right now. In the future I'm hoping to move it to a heavily containerised system in a VPS so that it can do more with less restrictions. Currently tests and editions other than 2024 stable aren't supported.

## Features

- Access inside a normal terminal window (the widget shows in a standard vscode terminal section)
- Includes command history and `clear` and feels just like a terminal
- Formatted output, using regex queries to make compiler messages, warnings, errors, and stuff look prettier and work better, similar to cargo
- Passes stdin via the websocket endpoint, enabling programs requiring user input
- Supports multi-file programs and programs using library crates
- It works without rust (provided you have vscode)

## Usage

Once you've got it instaleld, RustTempest uses the normal VSCocd extension system, with a terminal window interface. To launch it, go to the Command Palette (`Ctrl+Shift+P`) and select `RustTempest: Start Terminal`.

RustTempest has 3 main commands that you need to use:

- `run`: Sends code to Rust Playground to run
  - This has both `--debug` or `--release` modes like cargo. the default: debug.
  - If you need stdin, you must use websocket mode, by adding `--socket`.
- `socket`: Manage the websocket connection
  - `socket status`: Check if the websocket is connected
  - `socket connect`: Connect to the RustPlayground websocket to enable stdin, and stream output live rather than waiting for the programto finish _(must be run before `run --socket` can be used)_
  - `socket disconnect`: Disconnect from RustPlayground websocket
- `clear`: Resets the terminal

## Installation

RustTempest is uploaded in the VSCode Marketplace, making it very easy for you to install. Either go to the web marketplace [here](https://marketplace.visualstudio.com/items?itemName=tempest-playground.rust-tempest), or search for `RustTempest` inside the VSCode. If you don't yet have VSCode, install it from [here](https://code.visualstudio.com/download) first.

## How it Works

In some places (such as shared devices, school laptops, etc.) you can't install rustup and compile rust programs locally, even if VSCode is allowed. However, an online tool [Rust Playground](https://play.rust-lang.org/) exists, designed to help users try out Rust without installing it. But you can't save here and it doesn't have all the nromal conveniences that you get naturally in VSCode. But it turns out that Rust Playground has an API with allows for sending code and receiving output, (sadly a bit poorly documented, but reading the code helped).

However, I had two initial issues with this. Firstly, the initial approach of using a HTTP GET request to the execute endpoint meant that I couldn't send stdin. This is impractical for many projects that take user input, because without stdin you can't send stdin, because HTTP GET requests arent back and forth. Upon trawling the source code, I discovered the Websocket endpoint I was hoping for. This enabled you two-way communication with your program, with only a bit of reworking.

Secondly, the Rust Playground API unfortunately doesn't support multiple files (at least on the API yet. The web editor does in the beta). This was unideal with my vision for the extension, limiting it to only very simple projects. But fortunately, because Rust is so simple and mdoular in terms of how it handles files and mods, you can concatenate multiple Rust files into one, by putting each into a mod block recursively. Whilst this process fails at some edge cases, for the majority of scenarios, it actually works surprinsingly well!
