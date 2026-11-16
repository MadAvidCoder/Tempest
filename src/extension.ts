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

	private execute(command: string){
		this.writeEmitter.fire(`Executing command: ${command}\r\n`);
	}

	handleInput(data: string): void {
		if (data === '\r') {
			this.writeEmitter.fire('\r\n');
			this.execute(this.input.trim());
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
