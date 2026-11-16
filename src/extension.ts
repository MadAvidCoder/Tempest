import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	console.log('Tempest is loading...');

	const disposable = vscode.commands.registerCommand('tempest.start', () => {
		const terminal = vscode.window.createTerminal({
			name: 'Tempest Terminal',
			pty: new Tempest()
		});

		terminal.show();
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }

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

type Result<T, E = Error> =
	| { ok: true; value: T }
	| { ok: false; error: E };

class Tempest implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	readonly onDidWrite = this.writeEmitter.event;

	private closeEmitter = new vscode.EventEmitter<void>();
	readonly onDidClose = this.closeEmitter.event;

	private input = '';
	private history: string[] = [];
	private historyIndex = -1;

	open(): void {
		this.writeEmitter.fire('Welcome to Tempest Terminal!\r\n');
		this.writeEmitter.fire('You can run Rust programs via a cloud server here...\r\n');
		this.writeEmitter.fire(`\x1b[36mtempest\x1b[0m \x1b[90m>\x1b[0m `);
	}
	close(): void { }

	private getActiveFile(): Result<string, string> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return { ok: false, error: "No active editor. Please open a file to run." };
		}
		const fileText = editor.document.getText();
		return { ok: true, value: fileText };
	}

	private async request_execute(code: string, mode: string): Promise<Result<ExecuteResp, string>> {
		try {
			let params: ExecuteReq = {
				version: "stable",
				code: code,
				mode: mode,
				edition: "2024",
				crateType: "bin",
				channel: "stable",
				tests: false,
			}
			const resp = await fetch("https://play.rust-lang.org/execute", {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json',
				},
				body: JSON.stringify(params),
			});
			if (!resp.ok) {
				return { ok: false, error: `HTTP error: ${resp.status}` };
			}
			const data = await resp.json() as ExecuteResp;
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
		reset: '\x1b[0m',
		red: '\x1b[31m',
		brightRed: '\x1b[91m',
		green: '\x1b[32m',
		brightGreen: '\x1b[92m',
		yellow: '\x1b[33m',
		blue: '\x1b[34m',
		cyan: '\x1b[36m',
		grey: '\x1b[90m',
		bold: '\x1b[1m'
	};

	private async execute(command: string) {
		switch (command) {
			case 'run': {
				let file = this.getActiveFile();
				if (file.ok) {
					let run_res = await this.request_execute(file.value, "debug");
					if (run_res.ok) {
						if (run_res.value.stderr) {
							this.writeEmitter.fire(`${this.colouriseOutput(run_res.value.stderr.replace(/\r?\n/g, '\r\n'))}`);
						}
						this.writeEmitter.fire(this.colouriseOutput(run_res.value.stdout.replace(/\r?\n/g, '\r\n')));
						// if (!run_res.value.success) {
						// 	this.writeEmitter.fire(`Execution failed: ${this.colouriseOutput(run_res.value.exitDetail.replace(/\r?\n/g, '\r\n'))}\r\n`);
						// }
					} else {
						this.writeEmitter.fire(`${this.colours.red}${this.colours.bold}Error:${this.colours.reset} ${run_res.error}`);
					}
				} else {
					this.writeEmitter.fire(file.error);
				}
				this.writeEmitter.fire('\r\n');
				break;
			}
			case 'clear':
				this.writeEmitter.fire('\x1b[2J\x1b[3J\x1b[H');
				break;
			default:
				this.writeEmitter.fire(`Command not found: ${command}\r\n`);
				this.writeEmitter.fire('\r\n');
				break;
		}
	}
	private colouriseOutput(output: string): string {
		return output.split(/\r?\n/).map(line => {
			let res = line;
			res = res.replace(/^(\s*)(Compiling|Finished|Running)\b/, (_, indent = '', word = '') => {
				return `${indent}${this.colours.green}${this.colours.bold}${word}${this.colours.reset}`;
			});
			res = res.replace(/\b(warning)(:)/gi, (_, word = '', colon = '') => {
				return `${this.colours.yellow}${this.colours.bold}${word}${this.colours.reset}${colon}`;
			});
			res = res.replace(/\b(error[^:]*)(:)/gi, (_, word = '', colon = '') => {
				return `${this.colours.brightRed}${this.colours.bold}${word}${this.colours.reset}${colon}`;
			});
			res = res.replace(/^(\s*)(-->\s*)([^:\s]+)(:.*)/, (_, indent = '', arrow = '', file = '', loc = '') => {
				return `${indent}${this.colours.cyan}${arrow}${this.colours.reset}${file}${loc}`;
			});
			res = res.replace(/^(\s*)(\d* *[|=])( *-+.*)?([^\^]*)$/, (_, indent = '', pipe = '', dashes = '', end = '') => {
				return `${indent}${this.colours.cyan}${pipe}${dashes}${this.colours.reset}${end}`;
			});
			res = res.replace(/^(\s*)(\d* *[|=])( *)(\^*)(.*)$/, (_, indent = '', pipe = '', gap = '', arrows = '', other = '') => {
				return `${indent}${this.colours.cyan}${pipe}${this.colours.reset}${gap}${this.colours.yellow}${arrows}${other}`;
			});

			return res;
		}).join('\r\n');
	}

	async handleInput(data: string) {
		if (data === '\r') {
			this.writeEmitter.fire('\r\n');
			await this.execute(this.input.trim());
			this.history.push(this.input);
			this.historyIndex++;
			this.input = '';
			this.writeEmitter.fire(`${this.colours.cyan}tempest${this.colours.reset} ${this.colours.grey}>${this.colours.reset} `);
		} else if (data === '\u007f') {
			if (this.input.length > 0) {
				this.input = this.input.slice(0, -1);
				this.writeEmitter.fire('\b \b');
			}
		} else if (data === '\x1b[A') { 
			this.nav("up");
		} else if (data === '\x1b[B') {
			this.nav('down');
		} else if (data >= ' ' && data <= '~') {
			this.input += data;
			this.writeEmitter.fire(data);
		}
	}

	private nav(dir: "up" | "down") {
		if (this.history.length === 0) {return };
		if (dir === 'down') {
			if (this.historyIndex < this.history.length - 1) {
				this.historyIndex++;
			}
		} else {
			if (this.historyIndex > 0) {
				this.historyIndex--;
			} else {
				this.historyIndex = -1;
			}
		}
		if (this.historyIndex !== -1) {
			this.input = this.history[this.historyIndex];
		}
		this.writeEmitter.fire('\r\x1b[2K');
		this.writeEmitter.fire(`${this.colours.cyan}tempest${this.colours.reset} ${this.colours.grey}>${this.colours.reset} ${this.input}`);
	}
}
