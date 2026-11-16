import * as vscode from "vscode";
import WebSocket from "ws";

export function activate(context: vscode.ExtensionContext) {
    console.log("Tempest is loading...");

    const disposable = vscode.commands.registerCommand("tempest.start", () => {
        const terminal = vscode.window.createTerminal({
            name: "Tempest Terminal",
            pty: new Tempest(),
        });

        terminal.show();
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}

interface ExecuteReq {
    version: string;
    edition: string;
    channel: string;
    code: string;
    mode: string;
    crateType: string;
    tests: boolean;
}
interface ExecuteResp {
    success: boolean;
    exitDetail: string;
    stdout: string;
    stderr: string;
}

type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

enum SocketStatus {
    Disconnected,
    Connecting,
    Connected,
}

class Tempest implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    readonly onDidWrite = this.writeEmitter.event;

    private closeEmitter = new vscode.EventEmitter<void>();
    readonly onDidClose = this.closeEmitter.event;

    private input = "";
    private history: string[] = [];
    private historyIndex = -1;
    private sequence = 0;

    private socket: WebSocket | undefined;
    private socket_status: SocketStatus = SocketStatus.Disconnected;

    private is_running: boolean = false;

    open(): void {
        this.writeEmitter.fire("Welcome to Tempest Terminal!\r\n");
        this.writeEmitter.fire(
            `Powered by ${this.colours.yellow}https://play.rust-lang.org/${this.colours.reset}\r\n`,
        );
        this.draw_prompt();
    }
    close(): void {
        this.socket?.close();
        this.socket = undefined;
        this.is_running = false;
        this.socket_status = SocketStatus.Disconnected;
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
    }

    private getActiveFile(): Result<string, string> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return {
                ok: false,
                error: "No active editor. Please open a file to run.",
            };
        }
        const fileText = editor.document.getText();
        return { ok: true, value: fileText };
    }

    private async request_execute(
        code: string,
        mode: string,
    ): Promise<Result<ExecuteResp, string>> {
        try {
            let params: ExecuteReq = {
                version: "stable",
                code: code,
                mode: mode,
                edition: "2024",
                crateType: "bin",
                channel: "stable",
                tests: false,
            };
            const resp = await fetch("https://play.rust-lang.org/execute", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify(params),
                signal: AbortSignal.timeout(30000),
            });
            if (!resp.ok) {
                return { ok: false, error: `HTTP error: ${resp.status}` };
            }
            const data = (await resp.json()) as ExecuteResp;
            return { ok: true, value: data };
        } catch (error) {
            let message = "Unknown error occurred";
            if (error instanceof Error) {
                message = error.message;
            } else if (typeof error === "string") {
                message = error;
            }
            return { ok: false, error: message };
        }
    }

    private colours = {
        reset: "\x1b[0m",
        red: "\x1b[31m",
        brightRed: "\x1b[91m",
        green: "\x1b[32m",
        brightGreen: "\x1b[92m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        cyan: "\x1b[36m",
        grey: "\x1b[90m",
        bold: "\x1b[1m",
    };

    private handle_socket_message(message: WebSocket.RawData) {
        if (this.is_running) {
            try {
                let data = JSON.parse(message.toString());
                switch (data.type) {
                    case "output/execute/wsExecuteStdout":
                        if (data.payload) {
                            this.writeEmitter.fire(
                                `${this.colouriseOutput(data.payload)}`,
                            );
                        }
                        break;
                    case "output/execute/wsExecuteStderr":
                        if (data.payload) {
                            this.writeEmitter.fire(
                                `${this.colouriseOutput(data.payload)}`,
                            );
                        }
                        break;
                    case "output/execute/wsExecuteEnd":
                        this.is_running = false;
                        this.draw_prompt();
                        break;
                    default:
                        console.log(`Unexpected websocket message: ${data}`);
                        break;
                }
            } catch (error) {
                console.log(`Unexpected websocket message: ${error}`);
            }
        }
    }
    private handle_socket_error(error: string) {
        console.log(`Websocket error: ${error}`);
    }

    private is_connecting(): boolean {
        return this.socket_status === SocketStatus.Connecting;
    }

    private async execute(input: string) {
        let [command, ...args] = input.split(/\s+/);

        switch (command) {
            case "socket": {
                if (
                    (args.includes("connect") || args.includes("--connect")) &&
                    this.socket_status === SocketStatus.Disconnected &&
                    (!this.socket ||
                        this.socket.readyState === WebSocket.CLOSED)
                ) {
                    this.socket_status = SocketStatus.Connecting;
                    this.socket = new WebSocket(
                        "wss://play.rust-lang.org/websocket",
                    );
                    this.socket.on("open", () => {
                        this.socket_status = SocketStatus.Connected;
                        this.writeEmitter.fire(
                            `${this.colours.green}Connected to Rust Playground.${this.colours.reset}\r\n`,
                        );
                        this.sequence = 0;
                        this.socket?.send(
                            JSON.stringify({
                                type: "websocket/connected",
                                payload: {
                                    iAcceptThisIsAnUnsupportedApi: true,
                                },
                                meta: {
                                    sequenceNumber: this.sequence,
                                },
                            }),
                        );
                        this.draw_prompt();
                    });
                    this.socket.on("close", () => {
                        this.socket_status = SocketStatus.Disconnected;
                        this.writeEmitter.fire("WebSocket closed.\r\n");
                        this.is_running = false;
                        this.socket = undefined;
                        this.draw_prompt();
                    });
                    this.socket.on("message", (data) => {
                        this.handle_socket_message(data);
                    });
                    this.socket.on("error", (error) => {
                        this.handle_socket_error(error.message);
                    });
                    this.writeEmitter.fire("Connecting to WebSocket...\r\n");
                } else if (
                    args.includes("disconnect") ||
                    args.includes("--disconnect")
                ) {
                    if (this.socket_status === SocketStatus.Connected) {
                        this.socket?.close();
                        this.writeEmitter.fire("Disconnecting...\r\n");
                    } else {
                        this.writeEmitter.fire("Already disconnected.\r\n");
                    }
                } else {
                    switch (this.socket_status) {
                        case SocketStatus.Disconnected:
                            this.writeEmitter.fire(
                                `WebSocket is ${this.colours.red}Disconnected${this.colours.reset}\r\n`,
                            );
                            break;
                        case SocketStatus.Connecting:
                            this.writeEmitter.fire(
                                `WebSocket is ${this.colours.yellow}Connecting...${this.colours.reset}\r\n`,
                            );
                            break;
                        case SocketStatus.Connected:
                            this.writeEmitter.fire(
                                `WebSocket is ${this.colours.green}Connected${this.colours.reset}\r\n`,
                            );
                            break;
                    }
                }

                break;
            }
            case "run": {
                let file = this.getActiveFile();
                if (args.includes("--socket")) {
                    if (this.socket_status !== SocketStatus.Connected) {
                        this.writeEmitter.fire(
                            `Websocket is not connected. Please run ${this.colours.yellow}\`socket connect\`${this.colours.reset}\r\n`,
                        );
                    } else if (file.ok) {
                        let mode = args.some((arg) =>
                            ["release", "--release", "-r"].includes(arg),
                        )
                            ? "release"
                            : "debug";
                        this.sequence++;
                        this.is_running = true;
                        this.socket?.send(
                            JSON.stringify({
                                type: "output/execute/wsExecuteRequest",
                                payload: {
                                    channel: "stable",
                                    mode,
                                    edition: "2024",
                                    crateType: "bin",
                                    tests: false,
                                    backtrace: false,
                                    code: file.value,
                                },
                                meta: {
                                    sequenceNumber: this.sequence,
                                },
                            }),
                        );
                    }
                } else {
                    if (file.ok) {
                        let mode = args.some((arg) =>
                            ["release", "--release", "-r"].includes(arg),
                        )
                            ? "release"
                            : "debug";
                        let run_res = await this.request_execute(
                            file.value,
                            mode,
                        );
                        if (run_res.ok) {
                            if (run_res.value.stderr) {
                                this.writeEmitter.fire(
                                    `${this.colouriseOutput(run_res.value.stderr.replace(/\r?\n/g, "\r\n"))}`,
                                );
                            }
                            this.writeEmitter.fire(
                                this.colouriseOutput(
                                    run_res.value.stdout.replace(
                                        /\r?\n/g,
                                        "\r\n",
                                    ),
                                ),
                            );
                            // if (!run_res.value.success) {
                            // 	this.writeEmitter.fire(`Execution failed: ${this.colouriseOutput(run_res.value.exitDetail.replace(/\r?\n/g, '\r\n'))}\r\n`);
                            // }
                        } else {
                            this.writeEmitter.fire(
                                `${this.colours.red}${this.colours.bold}Error:${this.colours.reset} ${run_res.error}`,
                            );
                        }
                    } else {
                        this.writeEmitter.fire(file.error);
                    }
                    this.writeEmitter.fire("\r\n");
                }
                break;
            }
            case "clear":
                this.writeEmitter.fire("\x1b[2J\x1b[3J\x1b[H");
                break;
            default:
                this.writeEmitter.fire(`Command not found: ${command}\r\n`);
                break;
        }
    }
    private colouriseOutput(output: string): string {
        return output
            .split(/\r?\n/)
            .map((line) => {
                let res = line;
                res = res.replace(
                    /^(\s*)(Compiling|Finished|Running)\b/,
                    (_, indent = "", word = "") => {
                        return `${indent}${this.colours.green}${this.colours.bold}${word}${this.colours.reset}`;
                    },
                );
                res = res.replace(
                    /\b(warning)(:)/gi,
                    (_, word = "", colon = "") => {
                        return `${this.colours.yellow}${this.colours.bold}${word}${this.colours.reset}${colon}`;
                    },
                );
                res = res.replace(
                    /\b(error[^:]*)(:)/gi,
                    (_, word = "", colon = "") => {
                        return `${this.colours.brightRed}${this.colours.bold}${word}${this.colours.reset}${colon}`;
                    },
                );
                res = res.replace(
                    /^(\s*)(-->\s*)([^:\s]+)(:.*)/,
                    (_, indent = "", arrow = "", file = "", loc = "") => {
                        return `${indent}${this.colours.cyan}${arrow}${this.colours.reset}${file}${loc}`;
                    },
                );
                res = res.replace(
                    /^( *)(\d+)( *)(\+.*)$/,
                    (_, indent, num, sep, line) => {
                        return `${indent}${this.colours.cyan}${num}${this.colours.reset}${sep}${this.colours.green}${line}${this.colours.reset}`;
                    },
                );
                res = res.replace(
                    /^( *)(\d+)( *)(-.*)$/,
                    (_, indent, num, sep, line) => {
                        return `${indent}${this.colours.cyan}${num}${this.colours.reset}${sep}${this.colours.red}${line}${this.colours.reset}`;
                    },
                );
                res = res.replace(
                    /^(\s*)(\d* *[|=])( *-+.*)?([^\n\+\^]*)$/,
                    (_, indent = "", pipe = "", dashes = "", end = "") => {
                        return `${indent}${this.colours.cyan}${pipe}${dashes}${this.colours.reset}${end}`;
                    },
                );
                res = res.replace(
                    /^(help)(:)/gi,
                    (_, word = "", colon = "") => {
                        return `${this.colours.cyan}${this.colours.bold}${word}${this.colours.reset}${colon}`;
                    },
                );
                res = res.replace(
                    /^(\s*)(\d* *[|=])( *)(\^+)([^\+\n]*)$/,
                    (
                        _,
                        indent = "",
                        pipe = "",
                        gap = "",
                        arrows = "",
                        other = "",
                    ) => {
                        return `${indent}${this.colours.cyan}${pipe}${this.colours.reset}${gap}${this.colours.yellow}${arrows}${other}`;
                    },
                );
                res = res.replace(
                    /^(\s*)(\d* *[|=])( *)(\++\s*)$/,
                    (_, indent = "", pipe = "", gap = "", plus = "") => {
                        return `${indent}${this.colours.cyan}${pipe}${this.colours.reset}${gap}${this.colours.green}${plus}${this.colours.reset}`;
                    },
                );
                res = res.replace(
                    /^(\s*)(\d* *[|=])( *)(-+\s*)$/,
                    (_, indent = "", pipe = "", gap = "", minus = "") => {
                        return `${indent}${this.colours.cyan}${pipe}${this.colours.reset}${gap}${this.colours.red}${minus}${this.colours.reset}`;
                    },
                );

                return res;
            })
            .join("\r\n");
    }

    private draw_prompt() {
        this.writeEmitter.fire(
            `${this.colours.cyan}tempest${this.colours.reset} ${this.colours.grey}>${this.colours.reset} `,
        );
    }

    async sendWebsocketInput(line: String) {
        if (this.socket_status === SocketStatus.Connected && this.is_running) {
            this.socket?.send(
                JSON.stringify({
                    type: "output/execute/wsExecuteStdin",
                    payload: line + "\n",
                    meta: {
                        sequenceNumber: this.sequence,
                    },
                }),
            );
        }
    }
    async killWebsocketTask() {
        if (this.socket_status === SocketStatus.Connected && this.is_running) {
            this.socket?.send(
                JSON.stringify({
                    type: "output/execute/wsExecuteKill",
                    meta: {
                        sequenceNumber: this.sequence,
                    },
                }),
            );
        }
    }

    async handleInput(data: string) {
        if (this.is_running) {
            if (data === "\x03") {
                this.killWebsocketTask();
                this.input = "";
                this.is_running = false;
                this.draw_prompt();
            } else if (data >= " " && data <= "~") {
                this.input += data;
                this.writeEmitter.fire(data);
            } else if (data === "\u007f") {
                if (this.input.length > 0) {
                    this.input = this.input.slice(0, -1);
                    this.writeEmitter.fire("\b \b");
                }
            } else if (data === "\r") {
                this.writeEmitter.fire("\r\n");
                this.sendWebsocketInput(this.input.trim());
                this.input = "";
            }
        } else if (this.socket_status !== SocketStatus.Connecting) {
            if (data === "\x03") {
                this.input = "";
                this.writeEmitter.fire("^C\r\n");
                this.draw_prompt();
                return;
            } else if (data === "\r") {
                this.writeEmitter.fire("\r\n");
                await this.execute(this.input.trim());
                if (this.input.trim().length > 0) {
                    this.history.push(this.input);
                }
                this.historyIndex = this.history.length;
                this.input = "";
                if (!this.is_running && !this.is_connecting()) {
                    this.draw_prompt();
                }
            } else if (data === "\u007f") {
                if (this.input.length > 0) {
                    this.input = this.input.slice(0, -1);
                    this.writeEmitter.fire("\b \b");
                }
            } else if (data === "\x1b[A") {
                this.nav("up");
            } else if (data === "\x1b[B") {
                this.nav("down");
            } else if (data >= " " && data <= "~") {
                this.input += data;
                this.writeEmitter.fire(data);
            }
        }
    }

    private nav(dir: "up" | "down") {
        if (this.history.length === 0) {
            return;
        }
        if (dir === "up") {
            if (this.historyIndex > 0) {
                this.historyIndex--;
            }
        } else {
            if (this.historyIndex < this.history.length - 1) {
                this.historyIndex++;
            } else {
                this.historyIndex = this.history.length;
                this.input = "";
            }
        }

        if (this.historyIndex < this.history.length) {
            this.input = this.history[this.historyIndex];
        }
        this.writeEmitter.fire("\r\x1b[2K");
        this.writeEmitter.fire(
            `${this.colours.cyan}tempest${this.colours.reset} ${this.colours.grey}>${this.colours.reset} ${this.input}`,
        );
    }
}
