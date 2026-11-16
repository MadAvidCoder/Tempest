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

type Result<T, E = Error> =
    | { ok: true; value: T }
    | { ok: false; error: E };

class Tempest implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	readonly onDidWrite = this.writeEmitter.event;
	
	private closeEmitter = new vscode.EventEmitter<void>();
	readonly onDidClose = this.closeEmitter.event;

	private input = '';

	open(): void {
		this.writeEmitter.fire('Welcome to Tempest Terminal!\r\n');
		this.writeEmitter.fire('You can run Rust programs via a cloud server here...\r\n');
		this.writeEmitter.fire('tempest> ');
	}
	close(): void {}

	private getActiveFile(): Result<string, string> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return {ok: false, error: "No active editor. Please open a file to run."};
		}
		const fileText = editor.document.getText();
		return {ok: true, value: fileText };
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
				return {ok: false, error: `HTTP error: ${resp.status}`};
			}
			const data = await resp.json() as ExecuteResp;
			return {ok: true, value: data};
		} catch (error) {
			let message = "Unknown error occurred";
			if (error instanceof Error) {
				message = error.message;
			} else if (typeof error === "string") {
				message = error;
			}
			return {ok: false, error: message};
		}
	}

	private async execute(command: string){
		switch (command) {
			case 'run':
				let file = this.getActiveFile();
				if (file.ok) {
					let run_res = await this.request_execute(file.value, "debug");
					if (run_res.ok) {
						if (run_res.value.stderr) {
							this.writeEmitter.fire(run_res.value.stderr.replace(/\r?\n/g, '\r\n'));
						}
						this.writeEmitter.fire(run_res.value.stdout.replace(/\r?\n/g, '\r\n'));
						if (!run_res.value.success) {
							this.writeEmitter.fire(`Execution failed: ${run_res.value.exitDetail.replace(/\r?\n/g, '\r\n')}\r\n`);
						}
					} else {
						this.writeEmitter.fire(`Error: ${run_res.error}`);
					}
				} else {
					this.writeEmitter.fire(file.error);
				}
				this.writeEmitter.fire('\r\n');
				break;
			default:
				this.writeEmitter.fire(`Command not found: ${command}\r\n`);
				this.writeEmitter.fire('\r\n');
				break;
		}
	}

	async handleInput(data: string) {
		if (data === '\r') {
			this.writeEmitter.fire('\r\n');
			await this.execute(this.input.trim());
			this.input = '';
			this.writeEmitter.fire('tempest> ');
		} else if (data === '\u007f') {
			if (this.input.length > 0) {
				this.input = this.input.slice(0, -1);
				this.writeEmitter.fire('\b \b');
			}
		} else if (data >= ' ' && data <= '~') {
			this.input += data;
			this.writeEmitter.fire(data);
		}
	}
}
