# RustTempest
RustTempest is a lightweight vscode extension that enables using the [Rust Playround](https://play.rust-lang.org/) from VSCode. This enables cloud compilation and testing rust code on devices which don't yet have rustc installed.

## Features
* **No account or authentication needed**
* **Works anywhere** with VSCode (no rust needed!)
* **Fully featured pseudoterminal** interface, with command history and `clear`
* **Access in a normal terminal window**
* Passes **stdin via websocket**, enabling programs requiring input
* Supports **multi-file programs** and programs using library crates
* **Formatted output**, using regex queries to colour-code compiler messages, warnings, errors, etc. like cargo

## Installation
*RustTempest* can be installed from VSCode Marketplace. Either visit the marketplace [here](https://marketplace.visualstudio.com/items?itemName=tempest-playground.rust-tempest), or search for `RustTempest` within VSCode.

## Usage
*RustTempest* uses a simple pseudoterminal interface. To launch it, go to the Command Palette (`Ctrl+Shift+P`) and select `RustTempest: Start Terminal`.

RustTempest has 3 main commands:

- `run`: Sends the code to Rust Playground to run
  - Supports `--debug` or `--release`. Default: **debug**.
  - If you need stdin, you must use **websocket mode**, by passing `--socket`.
- `socket`: Manage the websocket connection
  - `socket status`: Check if the websocket is connected
  - `socket connect`: Connect to the RustPlayground websocket *(must be run before `run --socket` can be used)*
  - `socket disconnect`: Disconnect from RustPlayground websocket
- `clear`: Resets the terminal
  
## How it Works
On certain environments (such as shared devices, school laptops, etc.) it is impractical (or even impossible) to install rustup and compile rust programs locally. However, an online editor [Rust Playground](https://play.rust-lang.org/) exists, allowing users to try out Rust without installing it. But saving is impossible here, and it doesn't provide typical conveniences that you get in VSCode. But it turns out that Rust Playground has an API with allows for sending code and receiving ouput.

However, there were two initial issues with this approach. Firstly, the initial approach of using a HTTP GET request meant that we couldn't send stdin. This is impractical for many projects that take user input. Upon trawling the source code, I discovered the Websocket endpoint I was hoping for. This enabled two-way communication with the cloud-compiled program, with only a bit of reworking the extension.

Secondly, the Rust Playground API unfortunately doesn't support multiple files. This was a major downside to my vision for the extension, limiting it to only very simple projects. But fortunately, thanks to the simple modular nature of Rust, it is possible to concatenate multiple Rust files into one, by putting each into a mod block recursively. Whilst this process fails at some edge cases, for the majority of scenarios, it actually works really well!