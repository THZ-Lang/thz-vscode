import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface ThzStackFrame {
  id: number;
  name: string;
  file: string;
  line: number;
}

interface ThzVariable {
  name: string;
  value: string;
  type: string;
}

export class ThzDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'thz') {
        config.type = 'thz';
        config.name = 'THZ: Depurar Arquivo Atual';
        config.request = 'launch';
        config.program = '${file}';
        config.stopOnEntry = false;
      }
    }

    if (!config.program) {
      config.program = '${file}';
    }

    return config;
  }
}

export class ThzDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
    _executable: vscode.DebugAdapterExecutable | undefined
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(new ThzDebugAdapter());
  }
}

export class ThzDebugAdapter implements vscode.DebugAdapter {
  private readonly _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this._onDidSendMessage.event;

  private sequence = 1;
  private currentFile = '';
  private lines: string[] = [];
  private currentLineIndex = 0;
  private executableLines: number[] = [];
  private breakpoints: Set<number> = new Set();
  private stopOnEntry = false;
  private isRunning = false;

  private localVariables: Map<string, ThzVariable> = new Map();
  private architectureMetadata: Map<string, string> = new Map();
  private structures: Map<string, string[]> = new Map();
  private currentProcedure = 'Principal';

  dispose(): void {
    this._onDidSendMessage.dispose();
  }

  handleMessage(msg: any): void {
    const command = msg.command;
    const seq = msg.seq;

    switch (command) {
      case 'initialize': {
        this.sendResponse(seq, command, {
          supportsConfigurationDoneRequest: true,
          supportsEvaluateForHovers: true,
          supportsStepBack: false,
          supportsSetVariable: true,
          supportsFunctionBreakpoints: false,
          supportsConditionalBreakpoints: false,
        });
        this.sendEvent('initialized');
        break;
      }

      case 'launch': {
        let programPath = msg.arguments?.program || '';
        this.stopOnEntry = !!msg.arguments?.stopOnEntry;

        if (programPath.includes('${file}')) {
          const ed = vscode.window.activeTextEditor;
          if (ed) programPath = ed.document.uri.fsPath;
        }

        this.carregarArquivo(programPath);
        this.sendResponse(seq, command, {});
        break;
      }

      case 'setBreakPoints': {
        const file = msg.arguments?.source?.path || '';
        const lines: number[] = (msg.arguments?.breakpoints || []).map((b: any) => b.line);
        this.breakpoints.clear();
        const responseBreakpoints = [];

        for (const l of lines) {
          this.breakpoints.add(l);
          responseBreakpoints.push({ verified: true, line: l });
        }

        this.sendResponse(seq, command, { breakpoints: responseBreakpoints });
        break;
      }

      case 'configurationDone': {
        this.sendResponse(seq, command, {});
        if (this.stopOnEntry && this.executableLines.length > 0) {
          this.currentLineIndex = this.executableLines[0] - 1;
          this.sendEvent('stopped', {
            reason: 'entry',
            threadId: 1,
            allThreadsStopped: true,
          });
        } else {
          this.continuarExecucao();
        }
        break;
      }

      case 'threads': {
        this.sendResponse(seq, command, {
          threads: [{ id: 1, name: 'THZ Main Execution Thread' }],
        });
        break;
      }

      case 'stackTrace': {
        const frameLine = this.currentLineIndex + 1;
        const frames: ThzStackFrame[] = [
          {
            id: 1,
            name: `${this.currentProcedure}()`,
            file: this.currentFile,
            line: frameLine,
          },
        ];

        this.sendResponse(seq, command, {
          stackFrames: frames.map(f => ({
            id: f.id,
            name: f.name,
            source: { name: path.basename(f.file), path: f.file },
            line: f.line,
            column: 1,
          })),
          totalFrames: 1,
        });
        break;
      }

      case 'scopes': {
        this.sendResponse(seq, command, {
          scopes: [
            { name: 'Variáveis Locais', variablesReference: 1000, expensive: false },
            { name: 'Metadados de Arquitetura', variablesReference: 2000, expensive: false },
            { name: 'Entidades & Estruturas', variablesReference: 3000, expensive: false },
          ],
        });
        break;
      }

      case 'variables': {
        const ref = msg.arguments?.variablesReference;
        const vars: any[] = [];

        if (ref === 1000) {
          // Variáveis Locais
          for (const [name, v] of this.localVariables.entries()) {
            vars.push({
              name: name,
              value: v.value,
              type: v.type,
              variablesReference: 0,
            });
          }
          if (vars.length === 0) {
            vars.push({ name: '(nenhuma variável no escopo)', value: '', variablesReference: 0 });
          }
        } else if (ref === 2000) {
          // Metadados
          for (const [k, val] of this.architectureMetadata.entries()) {
            vars.push({ name: k, value: val, type: 'METADADO', variablesReference: 0 });
          }
        } else if (ref === 3000) {
          // Estruturas
          for (const [nome, campos] of this.structures.entries()) {
            vars.push({ name: nome, value: campos.join(', '), type: 'ESTRUTURA', variablesReference: 0 });
          }
        }

        this.sendResponse(seq, command, { variables: vars });
        break;
      }

      case 'next': {
        this.sendResponse(seq, command, {});
        this.avancarPasso();
        break;
      }

      case 'stepIn':
      case 'stepOut': {
        this.sendResponse(seq, command, {});
        this.avancarPasso();
        break;
      }

      case 'continue': {
        this.sendResponse(seq, command, {});
        this.continuarExecucao();
        break;
      }

      case 'evaluate': {
        const expr = (msg.arguments?.expression || '').trim();
        let result = 'indefinido';

        if (this.localVariables.has(expr)) {
          result = this.localVariables.get(expr)!.value;
        } else if (this.architectureMetadata.has(expr.toUpperCase())) {
          result = this.architectureMetadata.get(expr.toUpperCase())!;
        } else {
          // Tenta avaliar propriedade x.y
          const parts = expr.split('.');
          if (parts.length === 2 && this.localVariables.has(parts[0])) {
            const v = this.localVariables.get(parts[0])!;
            const m = v.value.match(new RegExp(`${parts[1]}:\\s*([^,)}]+)`));
            if (m) result = m[1].trim();
          }
        }

        this.sendResponse(seq, command, {
          result: result,
          variablesReference: 0,
        });
        break;
      }

      case 'disconnect':
      case 'terminate': {
        this.isRunning = false;
        this.sendResponse(seq, command, {});
        this.sendEvent('terminated');
        break;
      }

      default: {
        this.sendResponse(seq, command, {});
        break;
      }
    }
  }

  private carregarArquivo(filePath: string): void {
    this.currentFile = filePath;
    this.localVariables.clear();
    this.architectureMetadata.clear();
    this.structures.clear();
    this.executableLines = [];

    if (!fs.existsSync(filePath)) {
      this.sendOutput(`[ERRO DEBUG] Arquivo não encontrado: ${filePath}\n`, 'stderr');
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    this.lines = content.split(/\r?\n/);

    let inProc = false;
    let procName = 'Principal';

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      const trimmed = line.trim();

      // Metadados
      const mMeta = trimmed.match(/^([A-Z_]+)\s*:\s*"([^"]+)"/);
      if (mMeta && !trimmed.startsWith('IDENTIFICADOR') && !trimmed.startsWith('RASTREIO')) {
        this.architectureMetadata.set(mMeta[1], mMeta[2]);
      }

      // Estrutura
      const mEstr = trimmed.match(/^ESTRUTURA\s+([A-Za-z0-9_]+)/);
      if (mEstr) {
        this.structures.set(mEstr[1], []);
      }

      // Procedimento / Operação
      const mProc = trimmed.match(/^(?:PROCEDIMENTO|OPERACAO)\s+([A-Za-z0-9_]+)/);
      if (mProc) {
        inProc = true;
        procName = mProc[1];
        this.currentProcedure = procName;
      }

      if (trimmed.startsWith('FIM') && (trimmed.includes('PROCEDIMENTO') || trimmed.includes('OPERACAO') || trimmed === 'FIM')) {
        inProc = false;
      }

      // Linhas executáveis
      if (
        inProc &&
        trimmed.length > 0 &&
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('INICIO') &&
        !trimmed.startsWith('CONTRATO') &&
        !trimmed.startsWith('EXIGE') &&
        !trimmed.startsWith('GARANTE')
      ) {
        this.executableLines.push(i + 1);
      }
    }

    if (this.executableLines.length > 0) {
      this.currentLineIndex = this.executableLines[0] - 1;
    }

    this.sendOutput(`[THZ DEBUG] Programa carregado: ${path.basename(filePath)} (${this.lines.length} linhas, ${this.executableLines.length} executáveis)\n`);
  }

  private avancarPasso(): void {
    if (this.executableLines.length === 0) {
      this.sendEvent('terminated');
      return;
    }

    const curLineNum = this.currentLineIndex + 1;
    this.executarLinha(curLineNum);

    // Encontra a próxima linha executável
    const idx = this.executableLines.findIndex(l => l > curLineNum);
    if (idx >= 0) {
      this.currentLineIndex = this.executableLines[idx] - 1;
      this.sendEvent('stopped', {
        reason: 'step',
        threadId: 1,
        allThreadsStopped: true,
      });
    } else {
      this.sendOutput('[THZ DEBUG] Execução finalizada com sucesso.\n');
      this.sendEvent('terminated');
    }
  }

  private continuarExecucao(): void {
    this.isRunning = true;

    while (this.isRunning) {
      const curLineNum = this.currentLineIndex + 1;
      this.executarLinha(curLineNum);

      const nextIdx = this.executableLines.findIndex(l => l > curLineNum);
      if (nextIdx < 0) {
        this.sendOutput('[THZ DEBUG] Execução concluída.\n');
        this.sendEvent('terminated');
        this.isRunning = false;
        break;
      }

      const nextLineNum = this.executableLines[nextIdx];
      this.currentLineIndex = nextLineNum - 1;

      if (this.breakpoints.has(nextLineNum)) {
        this.sendEvent('stopped', {
          reason: 'breakpoint',
          threadId: 1,
          allThreadsStopped: true,
        });
        this.isRunning = false;
        break;
      }
    }
  }

  private executarLinha(lineNum: number): void {
    if (lineNum <= 0 || lineNum > this.lines.length) return;
    const lineText = this.lines[lineNum - 1].trim();

    // EXIBA "texto"
    const mExiba = lineText.match(/^EXIBA\s+(.+)$/);
    if (mExiba) {
      let rawExpr = mExiba[1];
      for (const [k, v] of this.localVariables.entries()) {
        rawExpr = rawExpr.replace(new RegExp(`\\b${k}\\b`, 'g'), v.value);
      }
      // Remove aspas concatenadas simples
      const msg = rawExpr.replace(/"\s*\+\s*"/g, '').replace(/^"/, '').replace(/"$/, '');
      this.sendOutput(`[SAÍDA] ${msg}\n`, 'stdout');
    }

    // VARIAVEL x : TIPO <- VALOR
    const mVar = lineText.match(/^VARIAVEL\s+([A-Za-z0-9_]+)(?:\s*:\s*([A-Za-z0-9_()]+))?\s*<-\s*(.+)$/);
    if (mVar) {
      const name = mVar[1];
      const type = mVar[2] || 'INFERIDO';
      let expr = mVar[3].trim();

      // Substitui variáveis existentes
      for (const [k, v] of this.localVariables.entries()) {
        expr = expr.replace(new RegExp(`\\b${k}\\b`, 'g'), v.value);
      }

      this.localVariables.set(name, {
        name: name,
        value: expr,
        type: type,
      });
      this.sendOutput(`[DEBUG] ${name} (${type}) = ${expr}\n`);
    }

    // Atribuição x <- VALOR
    const mAtrib = lineText.match(/^([A-Za-z0-9_]+)\s*<-\s*(.+)$/);
    if (mAtrib && !lineText.startsWith('VARIAVEL')) {
      const name = mAtrib[1];
      let expr = mAtrib[2].trim();
      const existing = this.localVariables.get(name);
      const type = existing ? existing.type : 'AUTO';

      for (const [k, v] of this.localVariables.entries()) {
        expr = expr.replace(new RegExp(`\\b${k}\\b`, 'g'), v.value);
      }

      this.localVariables.set(name, { name, value: expr, type });
      this.sendOutput(`[DEBUG] ${name} <- ${expr}\n`);
    }
  }

  private sendResponse(requestSeq: number, command: string, body: any): void {
    this._onDidSendMessage.fire({
      seq: this.sequence++,
      type: 'response',
      request_seq: requestSeq,
      command: command,
      success: true,
      body: body,
    });
  }

  private sendEvent(event: string, body: any = {}): void {
    this._onDidSendMessage.fire({
      seq: this.sequence++,
      type: 'event',
      event: event,
      body: body,
    });
  }

  private sendOutput(text: string, category: 'stdout' | 'stderr' | 'console' = 'console'): void {
    this.sendEvent('output', {
      category: category,
      output: text,
    });
  }
}
