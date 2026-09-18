import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  Executable,
} from 'vscode-languageclient/node';
import { ThzDebugConfigurationProvider, ThzDebugAdapterDescriptorFactory } from './debugAdapter';

let client: LanguageClient | undefined;
let thzTerminal: vscode.Terminal | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // ==========================================================================
  // 0. DEPURAÃ‡ÃƒO NATIVA E RUN & DEBUG (DAP - Debug Adapter Protocol)
  // ==========================================================================
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('thz', new ThzDebugConfigurationProvider()),
    vscode.debug.registerDebugAdapterDescriptorFactory('thz', new ThzDebugAdapterDescriptorFactory())
  );
  const config = vscode.workspace.getConfiguration('thz-lang');
  const customJar = config.get<string>('lspJarPath');

  const buildDirs = [
    context.asAbsolutePath('server'),
    path.resolve(context.extensionPath, '..', 'thz-lsp-jvm', 'build', 'libs'),
    path.resolve(context.extensionPath, '..', 'thz-lang', 'target'),
    path.resolve(context.extensionPath, '..', '..', 'JVM', 'thz-lsp-jvm', 'build', 'libs'),
    path.resolve(context.extensionPath, '..', '..', 'target'),
  ];

  const candidatos: string[] = [];
  if (customJar) candidatos.push(customJar);

  for (const dir of buildDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        const jarFound = files.find(f => f.startsWith('thz-lsp') && f.endsWith('.jar') && !f.includes('-sources'));
        if (jarFound) {
          candidatos.push(path.join(dir, jarFound));
        }
      } catch (ignored) {}
    }
  }
  candidatos.push(context.asAbsolutePath(path.join('server', 'thz-lsp.jar')));

  let jarPath: string | undefined;
  for (const cand of candidatos) {
    if (fs.existsSync(cand)) {
      jarPath = cand;
      break;
    }
  }

  if (!jarPath) {
    vscode.window.showWarningMessage(
      'THZ-LANG: Servidor LSP Java nÃ£o foi encontrado. Execute "./gradlew :thz-lsp-jvm:jar" para compilÃ¡-lo.'
    );
    jarPath = candidatos[candidatos.length - 1];
  }

  const javaExecutable: Executable = {
    command: 'java',
    args: ['-jar', jarPath, '--stdio'],
    options: {
      env: process.env,
    },
  };

  const serverOptions: ServerOptions = {
    run: javaExecutable,
    debug: javaExecutable,
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'thz' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.thz'),
    },
  };

  client = new LanguageClient('thz-lang', 'THZ-LANG Language Server', serverOptions, clientOptions);
  client.start();
  context.subscriptions.push({ dispose: () => client?.stop() } as vscode.Disposable);

  // ==========================================================================
  // 1. EXECUÃ‡ÃƒO NO TERMINAL INTEGRADO
  // ==========================================================================

  function resolverComandoCli(filePath?: string, argsExtras: string = ''): { comando: string; cwd?: string } {
    const customCli = vscode.workspace.getConfiguration('thz-lang').get<string>('cliPath');
    const ed = vscode.window.activeTextEditor;
    const workspaceFolder = ed ? vscode.workspace.getWorkspaceFolder(ed.document.uri) : (vscode.workspace.workspaceFolders?.[0]);
    const root = workspaceFolder ? workspaceFolder.uri.fsPath : undefined;
    const isWin = process.platform === 'win32';

    const targetArg = filePath ? `"${filePath}"` : '';
    const fullArgs = [argsExtras, targetArg].filter(s => s.trim().length > 0).join(' ');

    if (customCli && customCli.trim().length > 0) {
      if (customCli.endsWith('.jar')) {
        return { comando: `java -jar "${customCli}" ${fullArgs}`, cwd: root };
      }
      return { comando: `"${customCli}" ${fullArgs}`, cwd: root };
    }

    if (root) {
      const gradlewSh = path.join(root, 'gradlew');
      const candidatosThzPs1 = [
        path.join(root, 'thz.ps1'),
        path.join(root, 'thz-lang', 'thz.ps1'),
        path.resolve(root, '..', 'thz-lang', 'thz.ps1')
      ];
      const candidatosThzCmd = [
        path.join(root, 'thz.cmd'),
        path.join(root, 'thz-lang', 'thz.cmd'),
        path.resolve(root, '..', 'thz-lang', 'thz.cmd')
      ];
      const candidatosGradlewBat = [
        path.join(root, 'gradlew.bat'),
        path.join(root, 'thz-lang', 'gradlew.bat'),
        path.resolve(root, '..', 'thz-lang', 'gradlew.bat')
      ];
      const candidatosGradlewSh = [
        gradlewSh,
        path.join(root, 'thz-lang', 'gradlew'),
        path.resolve(root, '..', 'thz-lang', 'gradlew')
      ];
      const candidateDirs = [
        path.join(root, 'target'),
        path.join(root, 'thz-lang', 'target'),
        path.resolve(root, '..', 'thz-lang', 'target'),
        path.join(root, 'thz-cli-jvm', 'build', 'libs'),
        path.resolve(root, '..', 'thz-cli-jvm', 'build', 'libs'),
        path.join(root, 'JVM', 'thz-cli-jvm', 'build', 'libs')
      ];
      let foundCliJar: string | undefined;

      for (const dir of candidateDirs) {
        if (fs.existsSync(dir)) {
          try {
            const files = fs.readdirSync(dir);
            const achado = files.find(f => (f.startsWith('thz-jvm') || f.startsWith('thz-cli')) && f.endsWith('.jar') && !f.includes('-sources'));
            if (achado) {
              foundCliJar = path.join(dir, achado);
              break;
            }
          } catch (ignored) {}
        }
      }

      if (foundCliJar && fs.existsSync(foundCliJar)) {
        return { comando: `java -jar "${foundCliJar}" ${fullArgs}`, cwd: root };
      }

      const thzPs1 = candidatosThzPs1.find(p => fs.existsSync(p));
      if (isWin && thzPs1) {
        return { comando: `& "${thzPs1}" ${fullArgs}`, cwd: path.dirname(thzPs1) };
      }

      const thzCmd = candidatosThzCmd.find(p => fs.existsSync(p));
      if (isWin && thzCmd) {
        return { comando: `& "${thzCmd}" ${fullArgs}`, cwd: path.dirname(thzCmd) };
      }

      const gradlewBatFound = candidatosGradlewBat.find(p => fs.existsSync(p));
      if (isWin && gradlewBatFound) {
        return { comando: `& "${gradlewBatFound}" :thz-cli-jvm:run --args="${fullArgs.replace(/"/g, '\\"')}"`, cwd: path.dirname(gradlewBatFound) };
      }

      const gradlewShFound = candidatosGradlewSh.find(p => fs.existsSync(p));
      if (!isWin && gradlewShFound) {
        return { comando: `"${gradlewShFound}" :thz-cli-jvm:run --args="${fullArgs.replace(/"/g, '\\"')}"`, cwd: path.dirname(gradlewShFound) };
      }
    }

    return { comando: `thz ${fullArgs}`, cwd: root };
  }

  function executarNoTerminal(acao: 'run' | 'check', principal?: string): void {
    const ed = vscode.window.activeTextEditor;
    if (!ed) {
      vscode.window.showInformationMessage('Abra um arquivo .thz para executar.');
      return;
    }

    if (ed.document.isDirty) {
      ed.document.save();
    }

    const filePath = ed.document.uri.fsPath;
    const args = principal ? `${acao} --principal "${principal}"` : acao;
    const { comando, cwd } = resolverComandoCli(filePath, args);

    if (!thzTerminal || thzTerminal.exitStatus !== undefined) {
      thzTerminal = vscode.window.createTerminal({
        name: 'THZ-LANG',
        cwd: cwd,
      });
    }

    thzTerminal.show(true);
    thzTerminal.sendText(comando);
  }

  // Comandos de ExecuÃ§Ã£o
  context.subscriptions.push(
    vscode.commands.registerCommand('thz.run', () => executarNoTerminal('run')),
    vscode.commands.registerCommand('thz.check', () => executarNoTerminal('check')),
    vscode.commands.registerCommand('thz.runTarget', (target: string) => executarNoTerminal('run', target)),

    vscode.commands.registerCommand('thz.openRepl', () => {
      const { comando, cwd } = resolverComandoCli(undefined, 'repl');
      const replTerm = vscode.window.createTerminal({ name: 'THZ REPL', cwd: cwd });
      replTerm.show(true);
      replTerm.sendText(comando);
    }),

    vscode.commands.registerCommand('thz.openGui', () => {
      const ed = vscode.window.activeTextEditor;
      const filePath = ed ? ed.document.uri.fsPath : undefined;
      const { comando, cwd } = resolverComandoCli(filePath, 'gui');
      const guiTerm = vscode.window.createTerminal({ name: 'THZ Desktop IDE', cwd: cwd });
      guiTerm.show(true);
      guiTerm.sendText(comando);
    })
  );

  // ==========================================================================
  // 2. CODELENS PROVIDER
  // ==========================================================================

  class ThzCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
      const lenses: vscode.CodeLens[] = [];
      const isEnabled = vscode.workspace.getConfiguration('thz-lang').get<boolean>('codeLens', true);
      if (!isEnabled) return lenses;

      const text = document.getText();
      const lines = text.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Regra de NegÃ³cio
        const matchRegra = line.match(/^\s*REGRA_NEGOCIO\s+([A-Za-z0-9_]+)/);
        if (matchRegra) {
          const nomeRegra = matchRegra[1];
          const range = new vscode.Range(i, 0, i, line.length);
          lenses.push(
            new vscode.CodeLens(range, {
              title: `â–¶ Executar Regra (${nomeRegra})`,
              command: 'thz.runTarget',
              arguments: [nomeRegra],
            }),
            new vscode.CodeLens(range, {
              title: 'ðŸ›¡ï¸ Auditar GovernanÃ§a',
              command: 'thz.showAudit',
            }),
            new vscode.CodeLens(range, {
              title: 'ðŸ“ Ver Arquitetura',
              command: 'thz.previewArchitecture',
            })
          );
        }

        // OperaÃ§Ã£o isolada
        const matchOp = line.match(/^\s*OPERACAO\s+([A-Za-z0-9_]+)/);
        if (matchOp) {
          const nomeOp = matchOp[1];
          const range = new vscode.Range(i, 0, i, line.length);
          lenses.push(
            new vscode.CodeLens(range, {
              title: `â–¶ Executar OperaÃ§Ã£o: ${nomeOp}()`,
              command: 'thz.runTarget',
              arguments: [nomeOp],
            })
          );
        }

        // Procedimento
        const matchProc = line.match(/^\s*PROCEDIMENTO\s+([A-Za-z0-9_]+)/);
        if (matchProc) {
          const nomeProc = matchProc[1];
          const range = new vscode.Range(i, 0, i, line.length);
          lenses.push(
            new vscode.CodeLens(range, {
              title: `â–¶ Executar Procedimento: ${nomeProc}()`,
              command: 'thz.runTarget',
              arguments: [nomeProc],
            })
          );
        }
      }

      return lenses;
    }
  }

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'thz', scheme: 'file' }, new ThzCodeLensProvider())
  );

  // ==========================================================================
  // 3. LIVE PREVIEW DE ARQUITETURA VIVA & DIAGRAMAS MERMAID (UX & ACESSIBILIDADE)
  // ==========================================================================

  let architecturePanel: vscode.WebviewPanel | undefined;

  interface ElementoArquitetura {
    id: string;
    tipo: 'MODULO' | 'ESTRUTURA' | 'ENUMERACAO' | 'REGRA' | 'OPERACAO' | 'PROCEDIMENTO' | 'PIPELINE' | 'CONTRATO' | 'INVARIANTE';
    nome: string;
    linha?: number;
    detalhes: {
      dominio?: string;
      camada?: string;
      slo?: string;
      autor?: string;
      criticidade?: string;
      versao?: string;
      requisito?: string;
      idRegra?: string;
      idempotente?: boolean;
      chaveIdempotencia?: string;
      layoutSoa?: boolean;
      campos?: { nome: string; tipo: string }[];
      valoresEnum?: string[];
      preCondicoes?: string[];
      posCondicoes?: string[];
      invariantes?: string[];
      operacoes?: { nome: string; params: string; retorno?: string; idempotente?: boolean }[];
      origemPipeline?: string;
      transformacaoPipeline?: string;
      destinoPipeline?: string;
    };
  }

  interface DadosArquiteturaCompleta {
    nomeModulo: string;
    tipoModulo: string;
    dominio: string;
    subdominio: string;
    camada: string;
    versao: string;
    autor: string;
    slo: string;
    criticidade: string;
    conformidade: string;
    elementos: ElementoArquitetura[];
    diagramas: {
      geral: string;
      entidades: string;
      regras: string;
      fluxo: string;
    };
  }

  function extrairDadosArquitetura(fonte: string): DadosArquiteturaCompleta {
    let nomeModulo = 'Programa THZ';
    let tipoModulo = 'PROGRAMA';
    const matchMod = fonte.match(/(?:(PROGRAMA(?:\s+VISUAL|\s+NEGOCIO|\s+ARQUITETURA)?|BIBLIOTECA|EXTENSAO|FERRAMENTA|TESTE))\s+([A-Za-z0-9_]+)/);
    if (matchMod) {
      tipoModulo = matchMod[1];
      nomeModulo = matchMod[2];
    }

    let dominio = 'Geral', subdominio = 'Principal', camada = 'DomÃ­nio', slo = 'N/A', autor = 'NÃ£o especificado', criticidade = 'MÃ©dia', versao = '1.0.0', conformidade = 'Nenhuma';
    const matchDom = fonte.match(/DOMINIO\s*:\s*"([^"]+)"/);
    if (matchDom) dominio = matchDom[1];
    const matchSubDom = fonte.match(/SUBDOMINIO\s*:\s*"([^"]+)"/);
    if (matchSubDom) subdominio = matchSubDom[1];
    const matchCam = fonte.match(/CAMADA\s*:\s*"([^"]+)"/);
    if (matchCam) camada = matchCam[1];
    const matchSlo = fonte.match(/SLO_LATENCIA_MAXIMA\s*:\s*"([^"]+)"/);
    if (matchSlo) slo = matchSlo[1];
    const matchAut = fonte.match(/AUTOR\s*:\s*"([^"]+)"/);
    if (matchAut) autor = matchAut[1];
    const matchCrit = fonte.match(/CRITICIDADE\s*:\s*"([^"]+)"/);
    if (matchCrit) criticidade = matchCrit[1];
    const matchVer = fonte.match(/VERSAO\s*:\s*"([^"]+)"/);
    if (matchVer) versao = matchVer[1];
    const matchConf = fonte.match(/CONFORMIDADE\s*:\s*"([^"]+)"/);
    if (matchConf) conformidade = matchConf[1];

    const elementos: ElementoArquitetura[] = [];
    const linhas = fonte.split(/\r?\n/);

    elementos.push({
      id: 'MOD_' + nomeModulo,
      tipo: 'MODULO',
      nome: nomeModulo,
      linha: 1,
      detalhes: { dominio, camada, slo, autor, criticidade, versao }
    });

    let estAtual: ElementoArquitetura | null = null;
    let regraAtual: ElementoArquitetura | null = null;
    let pipeAtual: ElementoArquitetura | null = null;

    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      const numLinha = i + 1;

      // ESTRUTURA
      const mEstrutura = l.match(/^\s*ESTRUTURA\s+([A-Za-z0-9_]+)(?:\s+(LAYOUT_COLUNAR))?/);
      if (mEstrutura) {
        estAtual = {
          id: 'EST_' + mEstrutura[1],
          tipo: 'ESTRUTURA',
          nome: mEstrutura[1],
          linha: numLinha,
          detalhes: {
            layoutSoa: !!mEstrutura[2],
            campos: [],
            invariantes: []
          }
        };
        elementos.push(estAtual);
      }
      if (estAtual) {
        const mCampo = l.match(/^\s*([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_<>[\]]+)/);
        if (mCampo && !l.includes('ESTRUTURA') && !l.includes('INVARIANTE')) {
          estAtual.detalhes.campos?.push({ nome: mCampo[1], tipo: mCampo[2] });
        }
        const mInv = l.match(/^\s*INVARIANTE\s+(.+)/);
        if (mInv) {
          estAtual.detalhes.invariantes?.push(mInv[1].trim());
        }
        if (l.match(/^\s*FIM_ESTRUTURA/)) {
          estAtual = null;
        }
      }

      // ENUMERACAO
      const mEnum = l.match(/^\s*ENUMERACAO\s+([A-Za-z0-9_]+)/);
      if (mEnum) {
        const valores = l.includes(':') ? l.split(':')[1].split(',').map(s => s.trim()) : [];
        elementos.push({
          id: 'ENUM_' + mEnum[1],
          tipo: 'ENUMERACAO',
          nome: mEnum[1],
          linha: numLinha,
          detalhes: { valoresEnum: valores }
        });
      }

      // REGRA_NEGOCIO
      const mRegra = l.match(/^\s*REGRA_NEGOCIO\s+([A-Za-z0-9_]+)/);
      if (mRegra) {
        regraAtual = {
          id: 'RN_' + mRegra[1],
          tipo: 'REGRA',
          nome: mRegra[1],
          linha: numLinha,
          detalhes: {
            preCondicoes: [],
            posCondicoes: [],
            operacoes: []
          }
        };
        elementos.push(regraAtual);
      }
      if (regraAtual) {
        const mBr = l.match(/IDENTIFICADOR_REGRA\s*:\s*"([^"]+)"/);
        if (mBr) regraAtual.detalhes.idRegra = mBr[1];
        const mReq = l.match(/RASTREIO_REQUISITO\s*:\s*"([^"]+)"/);
        if (mReq) regraAtual.detalhes.requisito = mReq[1];
        const mIdemp = l.match(/IDEMPOTENTE(?:\s*\(\s*CHAVE\s*:\s*"([^"]+)"\s*\))?/);
        if (mIdemp) {
          regraAtual.detalhes.idempotente = true;
          if (mIdemp[1]) regraAtual.detalhes.chaveIdempotencia = mIdemp[1];
        }
        const mExige = l.match(/^\s*EXIGE\s+(.+)/);
        if (mExige) regraAtual.detalhes.preCondicoes?.push(mExige[1].trim());
        const mGarante = l.match(/^\s*GARANTE\s+(.+)/);
        if (mGarante) regraAtual.detalhes.posCondicoes?.push(mGarante[1].trim());

        const mOp = l.match(/^\s*OPERACAO\s+(?:(IDEMPOTENTE)\s+)?([A-Za-z0-9_]+)\s*\((.*?)\)(?:\s*:\s*([A-Za-z0-9_<>[\]]+))?/);
        if (mOp) {
          const opObj = {
            nome: mOp[2],
            params: mOp[3] || 'vazio',
            retorno: mOp[4] || 'Nenhum',
            idempotente: !!mOp[1]
          };
          regraAtual.detalhes.operacoes?.push(opObj);
          elementos.push({
            id: 'OP_' + regraAtual.nome + '_' + mOp[2],
            tipo: 'OPERACAO',
            nome: mOp[2],
            linha: numLinha,
            detalhes: {
              idRegra: regraAtual.detalhes.idRegra,
              operacoes: [opObj]
            }
          });
        }
        if (l.match(/^\s*FIM_REGRA_NEGOCIO/)) {
          regraAtual = null;
        }
      }

      // PIPELINE_DADOS
      const mPipe = l.match(/^\s*PIPELINE_DADOS\s+([A-Za-z0-9_]+)/);
      if (mPipe) {
        pipeAtual = {
          id: 'PIPE_' + mPipe[1],
          tipo: 'PIPELINE',
          nome: mPipe[1],
          linha: numLinha,
          detalhes: {}
        };
        elementos.push(pipeAtual);
      }
      if (pipeAtual) {
        const mFonte = l.match(/FONTE_ENTRADA\s*:\s*(.+)/);
        if (mFonte) pipeAtual.detalhes.origemPipeline = mFonte[1].trim();
        const mTransf = l.match(/TRANSFORMACAO\s*:\s*(.+)/);
        if (mTransf) pipeAtual.detalhes.transformacaoPipeline = mTransf[1].trim();
        const mDest = l.match(/DESTINO_SAIDA\s*:\s*(.+)/);
        if (mDest) pipeAtual.detalhes.destinoPipeline = mDest[1].trim();
        if (l.match(/^\s*FIM_PIPELINE/)) {
          pipeAtual = null;
        }
      }

      // PROCEDIMENTO
      const mProc = l.match(/^\s*PROCEDIMENTO\s+(?:(IDEMPOTENTE)\s+)?([A-Za-z0-9_]+)\s*\((.*?)\)/);
      if (mProc) {
        elementos.push({
          id: 'PROC_' + mProc[2],
          tipo: 'PROCEDIMENTO',
          nome: mProc[2],
          linha: numLinha,
          detalhes: {
            idempotente: !!mProc[1],
            operacoes: [{ nome: mProc[2], params: mProc[3] || 'vazio' }]
          }
        });
      }
    }

    function sanitizarId(s: string): string {
      return s ? s.replace(/[^a-zA-Z0-9_]/g, '_') : 'node';
    }

    function escaparMermaidTexto(s: string): string {
      if (!s) return '';
      return s
        .replace(/"/g, "'")
        .replace(/&/g, 'e')
        .replace(/[<>{}[\]]/g, '')
        .replace(/[\r\n]+/g, ' ')
        .trim();
    }

    const ests = elementos.filter(e => e.tipo === 'ESTRUTURA');
    const regras = elementos.filter(e => e.tipo === 'REGRA');
    const pipes = elementos.filter(e => e.tipo === 'PIPELINE');
    const procs = elementos.filter(e => e.tipo === 'PROCEDIMENTO');

    // 1. Diagrama Geral (HierÃ¡rquico com classes de estilo de alto contraste)
    let diagGeral = 'graph TD\n';
    diagGeral += '    classDef entity fill:#1e3a8a,stroke:#60a5fa,stroke-width:2px,color:#eff6ff;\n';
    diagGeral += '    classDef rule fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#ecfdf5;\n';
    diagGeral += '    classDef op fill:#78350f,stroke:#fbbf24,stroke-width:2px,color:#fffbeb;\n';
    diagGeral += '    classDef req fill:#4c1d95,stroke:#a78bfa,stroke-width:2px,color:#f5f3ff;\n';
    diagGeral += '    classDef pipe fill:#134e4a,stroke:#2dd4bf,stroke-width:2px,color:#f0fdf4;\n';
    diagGeral += '    classDef gate fill:#881337,stroke:#f43f5e,stroke-width:2px,color:#fff1f2;\n';

    diagGeral += `    subgraph Modulo ["ðŸ›ï¸ ${escaparMermaidTexto(nomeModulo)} (${escaparMermaidTexto(camada)})"]\n`;
    diagGeral += `        direction TB\n`;

    if (ests.length > 0) {
      diagGeral += `        subgraph Entidades ["ðŸ“¦ Entidades e Modelos de Dados"]\n`;
      for (const e of ests) {
        const flagSoa = e.detalhes.layoutSoa ? ' (SoA/SIMD)' : '';
        diagGeral += `            ${e.id}["ðŸ“¦ ${escaparMermaidTexto(e.nome + flagSoa)}"]\n`;
      }
      diagGeral += `        end\n`;
    }

    if (regras.length > 0) {
      diagGeral += `        subgraph RegrasDDD ["ðŸ›¡ï¸ Regras de NegÃ³cio e Contratos"]\n`;
      for (const r of regras) {
        const idLabel = r.detalhes.idRegra ? `(${r.detalhes.idRegra}) ` : '';
        const idempIcon = r.detalhes.idempotente ? ' ðŸ›¡ï¸' : '';
        diagGeral += `            ${r.id}["âš–ï¸ ${escaparMermaidTexto(idLabel + r.nome + idempIcon)}"]\n`;

        if (r.detalhes.requisito) {
          const reqClean = escaparMermaidTexto(r.detalhes.requisito);
          const reqId = sanitizarId('REQ_' + r.nome);
          diagGeral += `            ${reqId}["ðŸ“‹ Req: ${reqClean}"] --> ${r.id}\n`;
        }

        if (r.detalhes.preCondicoes && r.detalhes.preCondicoes.length > 0) {
          const preId = sanitizarId('PRE_' + r.nome);
          diagGeral += `            ${preId}["ðŸ›¡ï¸ EXIGE: ${r.detalhes.preCondicoes.length} clÃ¡usula(s)"] -.-> ${r.id}\n`;
        }

        if (r.detalhes.operacoes) {
          for (const op of r.detalhes.operacoes) {
            const opId = sanitizarId('OP_' + r.nome + '_' + op.nome);
            const opIdemp = op.idempotente ? ' âš¡(Idemp)' : ' âš¡';
            diagGeral += `            ${r.id} ==> ${opId}["${opIdemp} ${escaparMermaidTexto(op.nome)}()"]\n`;
          }
        }

        if (r.detalhes.posCondicoes && r.detalhes.posCondicoes.length > 0) {
          const posId = sanitizarId('POS_' + r.nome);
          diagGeral += `            ${r.id} -.-> ${posId}["âœ… GARANTE: ${r.detalhes.posCondicoes.length} clÃ¡usula(s)"]\n`;
        }
      }
      diagGeral += `        end\n`;
    }

    if (pipes.length > 0) {
      diagGeral += `        subgraph Pipelines ["ðŸš€ Pipelines de Dados"]\n`;
      for (const p of pipes) {
        diagGeral += `            ${p.id}["ðŸ”„ Pipeline: ${escaparMermaidTexto(p.nome)}"]\n`;
      }
      diagGeral += `        end\n`;
    }

    diagGeral += `    end\n`;

    for (const e of ests) {
      diagGeral += `    class ${e.id} entity;\n`;
    }
    for (const r of regras) {
      diagGeral += `    class ${r.id} rule;\n`;
      if (r.detalhes.requisito) diagGeral += `    class ${sanitizarId('REQ_' + r.nome)} req;\n`;
      if (r.detalhes.preCondicoes && r.detalhes.preCondicoes.length > 0) diagGeral += `    class ${sanitizarId('PRE_' + r.nome)} gate;\n`;
      if (r.detalhes.operacoes) {
        for (const op of r.detalhes.operacoes) {
          diagGeral += `    class ${sanitizarId('OP_' + r.nome + '_' + op.nome)} op;\n`;
        }
      }
      if (r.detalhes.posCondicoes && r.detalhes.posCondicoes.length > 0) diagGeral += `    class ${sanitizarId('POS_' + r.nome)} gate;\n`;
    }
    for (const p of pipes) {
      diagGeral += `    class ${p.id} pipe;\n`;
    }

    // 2. Diagrama de Entidades (Class Diagram)
    let diagEntidades = 'classDiagram\n';
    for (const e of ests) {
      diagEntidades += `    class ${sanitizarId(e.nome)} {\n`;
      if (e.detalhes.layoutSoa) diagEntidades += `        <<LAYOUT_COLUNAR_SoA>>\n`;
      if (e.detalhes.campos) {
        for (const c of e.detalhes.campos) {
          const tipoSanitizado = c.tipo.replace(/[\[\]]/g, '_').replace(/[(),]/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
          diagEntidades += `        +${tipoSanitizado} ${sanitizarId(c.nome)}\n`;
        }
      }
      if (e.detalhes.invariantes) {
        for (let invIdx = 0; invIdx < e.detalhes.invariantes.length; invIdx++) {
          diagEntidades += `        +invariante_${invIdx + 1}()\n`;
        }
      }
      diagEntidades += `    }\n`;
    }
    if (ests.length === 0) {
      diagEntidades += '    class SemEstruturas {\n        +info Sem_Estruturas_Declaradas\n    }\n';
    }

    // 3. Diagrama de Regras
    let diagRegras = 'graph TD\n';
    diagRegras += '    classDef rule fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#ecfdf5;\n';
    diagRegras += '    classDef req fill:#4c1d95,stroke:#a78bfa,stroke-width:2px,color:#f5f3ff;\n';
    diagRegras += '    classDef op fill:#78350f,stroke:#fbbf24,stroke-width:2px,color:#fffbeb;\n';
    diagRegras += '    classDef gate fill:#881337,stroke:#f43f5e,stroke-width:2px,color:#fff1f2;\n';
    for (const r of regras) {
      const idLabel = r.detalhes.idRegra ? `(${r.detalhes.idRegra}) ` : '';
      diagRegras += `    ${r.id}["âš–ï¸ Regra: ${escaparMermaidTexto(idLabel + r.nome)}"]\n`;
      diagRegras += `    class ${r.id} rule;\n`;
      if (r.detalhes.requisito) {
        const reqClean = escaparMermaidTexto(r.detalhes.requisito);
        const reqId = sanitizarId('REQ_' + r.nome);
        diagRegras += `    ${reqId}["ðŸ“Œ Requisito: ${reqClean}"] --> ${r.id}\n`;
        diagRegras += `    class ${reqId} req;\n`;
      }
      if (r.detalhes.preCondicoes) {
        for (let i = 0; i < r.detalhes.preCondicoes.length; i++) {
          const preClean = escaparMermaidTexto(r.detalhes.preCondicoes[i]);
          const exId = sanitizarId(`EX_${r.nome}_${i}`);
          diagRegras += `    ${r.id} --> ${exId}["ðŸ›¡ï¸ EXIGE: ${preClean}"]\n`;
          diagRegras += `    class ${exId} gate;\n`;
        }
      }
      if (r.detalhes.operacoes) {
        for (const op of r.detalhes.operacoes) {
          const opId = sanitizarId(`OP_${r.nome}_${op.nome}`);
          diagRegras += `    ${r.id} ==> ${opId}["âš¡ OperaÃ§Ã£o: ${escaparMermaidTexto(op.nome)}()"]\n`;
          diagRegras += `    class ${opId} op;\n`;
        }
      }
      if (r.detalhes.posCondicoes) {
        for (let i = 0; i < r.detalhes.posCondicoes.length; i++) {
          const posClean = escaparMermaidTexto(r.detalhes.posCondicoes[i]);
          const gaId = sanitizarId(`GA_${r.nome}_${i}`);
          diagRegras += `    ${r.id} --> ${gaId}["âœ… GARANTE: ${posClean}"]\n`;
          diagRegras += `    class ${gaId} gate;\n`;
        }
      }
    }
    if (regras.length === 0) diagRegras += '    SemRegras["Nenhuma Regra Declarada"]\n';

    // 4. Diagrama de Fluxo e Pipelines
    let diagFluxo = 'graph LR\n';
    diagFluxo += '    classDef pipe fill:#134e4a,stroke:#2dd4bf,stroke-width:2px,color:#f0fdf4;\n';
    diagFluxo += '    classDef proc fill:#1e3a8a,stroke:#60a5fa,stroke-width:2px,color:#eff6ff;\n';
    for (const p of pipes) {
      const org = p.detalhes.origemPipeline ? escaparMermaidTexto(p.detalhes.origemPipeline) : 'Entrada';
      const dst = p.detalhes.destinoPipeline ? escaparMermaidTexto(p.detalhes.destinoPipeline) : 'SaÃ­da';
      diagFluxo += `    ${p.id}_IN["ðŸ“¥ Fonte: ${org}"] --> ${p.id}["ðŸ”„ Pipeline: ${escaparMermaidTexto(p.nome)}"] --> ${p.id}_OUT["ðŸ“¤ Destino: ${dst}"]\n`;
      diagFluxo += `    class ${p.id} pipe;\n`;
    }
    for (const pr of procs) {
      diagFluxo += `    ${pr.id}["ðŸš€ Procedimento: ${escaparMermaidTexto(pr.nome)}()"]\n`;
      diagFluxo += `    class ${pr.id} proc;\n`;
    }
    if (pipes.length === 0 && procs.length === 0) diagFluxo += '    SemFluxo["Nenhum Pipeline ou Procedimento Declarado"]\n';

    return {
      nomeModulo,
      tipoModulo,
      dominio,
      subdominio,
      camada,
      versao,
      autor,
      slo,
      criticidade,
      conformidade,
      elementos,
      diagramas: {
        geral: diagGeral,
        entidades: diagEntidades,
        regras: diagRegras,
        fluxo: diagFluxo
      }
    };
  }

  function renderizarHtmlArquitetura(fonte: string): string {
    const dados = extrairDadosArquitetura(fonte);
    const dadosJson = JSON.stringify(dados).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>THZ Living Architecture â€” ${dados.nomeModulo}</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #0d1117);
      --card-bg: var(--vscode-sideBar-background, #161b22);
      --border: var(--vscode-panel-border, rgba(240, 246, 252, 0.15));
      --text: var(--vscode-editor-foreground, #e6edf3);
      --muted: var(--vscode-descriptionForeground, #8b949e);
      --primary: var(--vscode-button-background, #238636);
      --primary-hover: var(--vscode-button-hoverBackground, #2ea043);
      --accent: var(--vscode-textLink-foreground, #58a6ff);
      --highlight: #f0883e;
      --badge-bg: rgba(88, 166, 255, 0.12);
      --badge-border: rgba(88, 166, 255, 0.3);
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    body.high-contrast {
      --bg: #000000;
      --card-bg: #121212;
      --border: #ffffff;
      --text: #ffffff;
      --muted: #cccccc;
      --accent: #ffff00;
      --primary: #00ff00;
      --highlight: #ff00ff;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--font); }
    body { background: var(--bg); color: var(--text); padding: 16px; line-height: 1.5; overflow-x: hidden; height: 100vh; display: flex; flex-direction: column; }

    /* Header e Metadados */
    header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 12px; flex-wrap: wrap; }
    .header-info h1 { font-size: 1.25rem; display: flex; align-items: center; gap: 8px; color: var(--accent); font-weight: 700; }
    .header-info p { font-size: 0.8rem; color: var(--muted); margin-top: 2px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; display: inline-block; }

    .header-actions { display: flex; gap: 8px; align-items: center; }
    .btn { background: var(--card-bg); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; font-size: 0.78rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s ease; }
    .btn:hover, .btn:focus-visible { background: var(--border); border-color: var(--accent); outline: 2px solid var(--accent); }
    .btn-primary { background: var(--primary); color: #ffffff; border-color: transparent; }
    .btn-primary:hover { background: var(--primary-hover); }

    /* Grid de Metadados ISO 42010 */
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 12px; }
    .meta-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; }
    .meta-card .label { font-size: 0.68rem; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; font-weight: 600; }
    .meta-card .val { font-size: 0.88rem; font-weight: 600; margin-top: 1px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta-card .val.highlight { color: var(--highlight); }

    /* Barra de NavegaÃ§Ã£o de VisualizaÃ§Ãµes & Busca */
    .controls-bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; background: var(--card-bg); padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); }
    .tabs { display: flex; gap: 4px; overflow-x: auto; }
    .tab-btn { background: transparent; border: none; color: var(--muted); padding: 5px 10px; border-radius: 5px; font-size: 0.78rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.15s ease; }
    .tab-btn:hover, .tab-btn:focus-visible { color: var(--text); background: var(--border); outline: 1px solid var(--accent); }
    .tab-btn.active { color: #ffffff; background: var(--accent); }

    .search-box { display: flex; align-items: center; gap: 6px; background: var(--bg); border: 1px solid var(--border); padding: 4px 8px; border-radius: 6px; flex: 1; max-width: 280px; }
    .search-box input { background: transparent; border: none; color: var(--text); font-size: 0.8rem; outline: none; width: 100%; }
    .search-box input::placeholder { color: var(--muted); }

    /* Viewport Interativo do Diagrama com Grid Canvas */
    .viewport-container { position: relative; flex: 1; min-height: 380px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; display: flex; justify-content: center; align-items: center; cursor: grab; user-select: none; }
    .viewport-container:active { cursor: grabbing; }
    .viewport-container::before { content: ""; position: absolute; inset: 0; background-image: radial-gradient(var(--border) 1px, transparent 1px); background-size: 20px 20px; opacity: 0.4; pointer-events: none; }

    #canvas { position: absolute; transform-origin: 0 0; transition: transform 0.05s linear; will-change: transform; display: flex; justify-content: center; align-items: center; padding: 40px; }
    #canvas svg { max-width: none !important; }

    /* Barra Flutuante de HUD (Pan / Zoom / Fit) */
    .hud-controls { position: absolute; bottom: 16px; right: 16px; display: flex; gap: 4px; background: rgba(22, 27, 34, 0.9); backdrop-filter: blur(8px); border: 1px solid var(--border); padding: 4px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10; }
    .hud-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: transparent; border: 1px solid transparent; color: var(--text); border-radius: 6px; cursor: pointer; font-size: 0.95rem; font-weight: bold; transition: all 0.15s ease; }
    .hud-btn:hover, .hud-btn:focus-visible { background: var(--border); border-color: var(--accent); outline: 2px solid var(--accent); }

    /* Destaque de Busca */
    .node-highlighted rect, .node-highlighted circle, .node-highlighted polygon { stroke: #fbbf24 !important; stroke-width: 4px !important; filter: drop-shadow(0 0 10px #fbbf24); }
    .node-dimmed { opacity: 0.25; filter: grayscale(80%); }

    /* Drawer de Detalhes do Elemento */
    .drawer { position: fixed; top: 0; right: -400px; width: 380px; height: 100vh; background: var(--card-bg); border-left: 2px solid var(--accent); box-shadow: -6px 0 20px rgba(0,0,0,0.5); padding: 20px; z-index: 100; transition: right 0.25s cubic-bezier(0.4, 0, 0.2, 1); overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
    .drawer.open { right: 0; }
    .drawer-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
    .drawer-header h3 { font-size: 1.1rem; color: var(--accent); }
    .drawer-close { background: transparent; border: none; color: var(--muted); font-size: 1.2rem; cursor: pointer; padding: 4px 8px; border-radius: 4px; }
    .drawer-close:hover { color: var(--text); background: var(--border); }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; background: var(--badge-bg); border: 1px solid var(--badge-border); color: var(--accent); }
    .drawer-section { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; font-size: 0.82rem; }
    .drawer-section h4 { font-size: 0.75rem; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }

    /* Modo Ãrvore AcessÃ­vel (Screen Reader / Outline) */
    .accessible-tree { display: none; width: 100%; height: 100%; overflow-y: auto; padding: 16px; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--border); }
    .accessible-tree.active { display: block; }
    .tree-card { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 10px; }
    .tree-card:focus-within { border-color: var(--accent); outline: 2px solid var(--accent); }
    .tree-card h3 { font-size: 0.95rem; color: var(--accent); display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .tree-card ul { list-style: square inside; margin-top: 4px; font-size: 0.82rem; color: var(--text); }

    /* RodapÃ© com Atalhos de Teclado */
    footer { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 0.72rem; color: var(--muted); }
    .kbd { background: var(--border); padding: 1px 5px; border-radius: 4px; font-family: monospace; font-size: 0.7rem; border: 1px solid var(--muted); }
  </style>
</head>
<body>
  <header role="banner">
    <div class="header-info">
      <h1>
        <span class="status-dot" aria-hidden="true"></span>
        ðŸ“ THZ-LANG â€” Arquitetura Viva & DDD
        <span class="badge">${dados.tipoModulo}</span>
      </h1>
      <p>MÃ³dulo: <strong>${dados.nomeModulo}</strong> | VersÃ£o: ${dados.versao} | Conformidade: <strong>${dados.conformidade}</strong></p>
    </div>
    <div class="header-actions" role="toolbar" aria-label="AÃ§Ãµes de VisualizaÃ§Ã£o">
      <button class="btn" id="btnHighContrast" aria-pressed="false" title="Alternar Alto Contraste (WCAG AAA)">ðŸŒ“ Alto Contraste</button>
      <button class="btn" id="btnCopyMermaid" title="Copiar cÃ³digo Mermaid">ðŸ“‹ Mermaid</button>
      <button class="btn" id="btnCopyMd" title="Copiar especificaÃ§Ã£o em Markdown">ðŸ“ Markdown</button>
      <button class="btn btn-primary" id="btnDownloadSvg" title="Baixar diagrama SVG">ðŸ’¾ Baixar SVG</button>
    </div>
  </header>

  <section class="meta-grid" aria-label="Metadados Arquiteturais ISO 42010">
    <div class="meta-card"><div class="label">DomÃ­nio</div><div class="val">${dados.dominio}</div></div>
    <div class="meta-card"><div class="label">SubdomÃ­nio</div><div class="val">${dados.subdominio}</div></div>
    <div class="meta-card"><div class="label">Camada</div><div class="val">${dados.camada}</div></div>
    <div class="meta-card"><div class="label">SLO MÃ¡ximo</div><div class="val highlight">${dados.slo}</div></div>
    <div class="meta-card"><div class="label">Criticidade</div><div class="val">${dados.criticidade}</div></div>
    <div class="meta-card"><div class="label">Autor / Time</div><div class="val">${dados.autor}</div></div>
  </section>

  <nav class="controls-bar" aria-label="Controles e Filtros de Arquitetura">
    <div class="tabs" role="tablist">
      <button class="tab-btn active" role="tab" aria-selected="true" data-tab="geral">ðŸŒ Arquitetura Geral</button>
      <button class="tab-btn" role="tab" aria-selected="false" data-tab="entidades">ðŸ“¦ Entidades (${dados.elementos.filter(e => e.tipo === 'ESTRUTURA').length})</button>
      <button class="tab-btn" role="tab" aria-selected="false" data-tab="regras">ðŸ›¡ï¸ Regras DDD (${dados.elementos.filter(e => e.tipo === 'REGRA').length})</button>
      <button class="tab-btn" role="tab" aria-selected="false" data-tab="fluxo">ðŸš€ Pipelines & Fluxo</button>
      <button class="tab-btn" role="tab" aria-selected="false" data-tab="acessivel">ðŸ“‘ Ãrvore SemÃ¢ntica (A11y)</button>
    </div>
    <div class="search-box" role="search">
      <span aria-hidden="true">ðŸ”</span>
      <input type="text" id="searchInput" placeholder="Buscar entidades, regras, contratos... ( / )" aria-label="Buscar elementos na arquitetura">
      <button id="clearSearch" style="background:none; border:none; color:var(--muted); cursor:pointer;" aria-label="Limpar busca">âœ•</button>
    </div>
  </nav>

  <!-- Viewport Interativo do Diagrama -->
  <main class="viewport-container" id="viewport" tabindex="0" role="region" aria-label="Visualizador Interativo de Diagramas (Arraste para mover, use roda do mouse ou botÃµes para zoom)">
    <div id="canvas"></div>

    <!-- HUD de NavegaÃ§Ã£o AcessÃ­vel -->
    <div class="hud-controls" role="toolbar" aria-label="NavegaÃ§Ã£o e Zoom do Diagrama">
      <button class="hud-btn" id="btnZoomIn" title="Aumentar Zoom ( + )" aria-label="Aumentar Zoom">ï¼‹</button>
      <button class="hud-btn" id="btnZoomOut" title="Diminuir Zoom ( - )" aria-label="Diminuir Zoom">ï¼</button>
      <button class="hud-btn" id="btnResetZoom" title="Tamanho Real 100% ( 0 )" aria-label="Tamanho 100%">1:1</button>
      <button class="hud-btn" id="btnFitScreen" title="Ajustar Ã  Tela ( F )" aria-label="Ajustar Ã  Tela">â›¶</button>
      <button class="hud-btn" id="btnCenter" title="Centralizar PosiÃ§Ã£o" aria-label="Centralizar PosiÃ§Ã£o">âŸ²</button>
    </div>

    <!-- Ãrvore AcessÃ­vel Textual -->
    <div class="accessible-tree" id="accessibleTree" role="tabpanel" aria-label="VisualizaÃ§Ã£o em Ãrvore AcessÃ­vel">
      <h2 style="font-size: 1.1rem; margin-bottom: 12px; color: var(--accent);">ðŸ“‹ Estrutura SemÃ¢ntica e Rastreabilidade Completa</h2>
      ${dados.elementos.map(el => `
        <article class="tree-card" tabindex="0">
          <h3>
            <span>${el.tipo === 'ESTRUTURA' ? 'ðŸ“¦' : el.tipo === 'REGRA' ? 'âš–ï¸' : el.tipo === 'PIPELINE' ? 'ðŸ”„' : 'ðŸš€'} ${el.nome}</span>
            <span class="badge">${el.tipo}</span>
          </h3>
          ${el.linha ? `<p style="font-size:0.75rem; color:var(--muted); margin-bottom:4px;">Declarado na Linha <strong>${el.linha}</strong></p>` : ''}
          ${el.detalhes.requisito ? `<p><strong>Rastreio Requisito:</strong> <code>${el.detalhes.requisito}</code></p>` : ''}
          ${el.detalhes.idRegra ? `<p><strong>ID da Regra:</strong> <code>${el.detalhes.idRegra}</code></p>` : ''}
          ${el.detalhes.idempotente ? `<p><strong>Garantia:</strong> ðŸ›¡ï¸ IDEMPOTENTE</p>` : ''}
          ${el.detalhes.campos && el.detalhes.campos.length > 0 ? `
            <div style="margin-top:6px;"><strong>Campos:</strong>
              <ul>${el.detalhes.campos.map(c => `<li><code>${c.nome}: ${c.tipo}</code></li>`).join('')}</ul>
            </div>` : ''}
          ${el.detalhes.invariantes && el.detalhes.invariantes.length > 0 ? `
            <div style="margin-top:6px; color:#f43f5e;"><strong>Invariantes de DomÃ­nio:</strong>
              <ul>${el.detalhes.invariantes.map(inv => `<li><code>INVARIANTE ${inv}</code></li>`).join('')}</ul>
            </div>` : ''}
          ${el.detalhes.preCondicoes && el.detalhes.preCondicoes.length > 0 ? `
            <div style="margin-top:6px; color:#a78bfa;"><strong>Contrato de Entrada (EXIGE):</strong>
              <ul>${el.detalhes.preCondicoes.map(ex => `<li><code>EXIGE ${ex}</code></li>`).join('')}</ul>
            </div>` : ''}
          ${el.detalhes.posCondicoes && el.detalhes.posCondicoes.length > 0 ? `
            <div style="margin-top:6px; color:#34d399;"><strong>Contrato de SaÃ­da (GARANTE):</strong>
              <ul>${el.detalhes.posCondicoes.map(ga => `<li><code>GARANTE ${ga}</code></li>`).join('')}</ul>
            </div>` : ''}
          ${el.linha ? `<button class="btn" style="margin-top:8px;" onclick="irParaLinha(${el.linha})">ðŸŽ¯ Ir para o CÃ³digo-Fonte (Linha ${el.linha})</button>` : ''}
        </article>
      `).join('')}
    </div>
  </main>

  <!-- Drawer Lateral de Detalhes do Elemento -->
  <aside class="drawer" id="elementDrawer" role="dialog" aria-labelledby="drawerTitle" aria-modal="true" aria-hidden="true">
    <div class="drawer-header">
      <h3 id="drawerTitle">Detalhes da Arquitetura</h3>
      <button class="drawer-close" id="drawerClose" aria-label="Fechar Detalhes">âœ•</button>
    </div>
    <div id="drawerContent"></div>
  </aside>

  <footer role="contentinfo">
    <div>Sincronizado em tempo real com o buffer ativo do THZ Engine</div>
    <div>Atalhos: <span class="kbd">+</span>/<span class="kbd">-</span> Zoom | <span class="kbd">0</span> 100% | <span class="kbd">F</span> Ajustar | <span class="kbd">W,A,S,D</span> Mover | <span class="kbd">/</span> Buscar | <span class="kbd">Esc</span> Fechar</div>
  </footer>

  <script>
    const vscode = acquireVsCodeApi();
    const DADOS_ARQUITETURA = ${dadosJson};

    // Estado do Viewport (Pan & Zoom)
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let tabAtual = 'geral';
    let renderCounter = 0;

    const canvas = document.getElementById('canvas');
    const viewport = document.getElementById('viewport');
    const drawer = document.getElementById('elementDrawer');
    const drawerContent = document.getElementById('drawerContent');
    const drawerTitle = document.getElementById('drawerTitle');

    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      fontFamily: 'var(--font)'
    });

    async function renderizarDiagrama(diagramSrc) {
      if (!canvas) return;
      try {
        renderCounter++;
        const renderId = 'mermaid-render-' + renderCounter;
        const { svg } = await mermaid.render(renderId, diagramSrc);
        canvas.innerHTML = svg;
        atribuirEventosNos();
        setTimeout(fitToScreen, 100);
      } catch (err) {
        console.error('Erro ao renderizar diagrama Mermaid:', err);
        canvas.innerHTML = '<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px; text-align:center; color:#f87171;">' +
          '<div style="font-size:2.5rem; margin-bottom:12px;">âš ï¸</div>' +
          '<h3 style="font-size:1.1rem; color:#fca5a5; margin-bottom:8px;">NÃ£o foi possÃ­vel renderizar o diagrama</h3>' +
          '<p style="font-size:0.82rem; color:var(--muted); max-width:480px; margin-bottom:16px; font-family:monospace; background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; border:1px solid var(--border);">' + (err.message || err) + '</p>' +
          '<button class="btn" id="btnCopiarMermaidFalha">ðŸ“‹ Copiar CÃ³digo Mermaid</button>' +
        '</div>';
        const btnFalha = document.getElementById('btnCopiarMermaidFalha');
        if (btnFalha) {
          btnFalha.addEventListener('click', () => {
            vscode.postMessage({ command: 'copyToClipboard', text: diagramSrc, feedback: 'CÃ³digo Mermaid copiado!' });
          });
        }
      }
    }

    function aplicarTransform() {
      canvas.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + scale + ')';
    }

    function zoom(delta, clientX, clientY) {
      const oldScale = scale;
      scale = Math.min(Math.max(0.15, scale + delta), 4.0);

      if (clientX !== undefined && clientY !== undefined) {
        const rect = viewport.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        panX -= (mouseX - panX) * (scale / oldScale - 1);
        panY -= (mouseY - panY) * (scale / oldScale - 1);
      }
      aplicarTransform();
    }

    function fitToScreen() {
      const svg = canvas.querySelector('svg');
      if (!svg) return;
      const vRect = viewport.getBoundingClientRect();
      const sRect = svg.getBoundingClientRect();
      if (sRect.width === 0 || sRect.height === 0) return;

      const currentW = sRect.width / scale;
      const currentH = sRect.height / scale;
      const scaleX = (vRect.width - 60) / currentW;
      const scaleY = (vRect.height - 60) / currentH;
      scale = Math.min(Math.max(0.2, Math.min(scaleX, scaleY)), 2.5);
      panX = (vRect.width - currentW * scale) / 2;
      panY = (vRect.height - currentH * scale) / 2;
      aplicarTransform();
    }

    function resetView() {
      scale = 1;
      panX = 0;
      panY = 0;
      aplicarTransform();
    }

    // Eventos do Mouse / Pointer no Viewport
    viewport.addEventListener('pointerdown', e => {
      if (e.target.closest('.hud-controls') || e.target.closest('.accessible-tree')) return;
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener('pointermove', e => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      aplicarTransform();
    });

    viewport.addEventListener('pointerup', e => {
      isDragging = false;
      try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    viewport.addEventListener('wheel', e => {
      if (tabAtual === 'acessivel') return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      zoom(delta, e.clientX, e.clientY);
    }, { passive: false });

    // HUD Buttons
    document.getElementById('btnZoomIn').addEventListener('click', () => zoom(0.2));
    document.getElementById('btnZoomOut').addEventListener('click', () => zoom(-0.2));
    document.getElementById('btnResetZoom').addEventListener('click', () => { scale = 1; aplicarTransform(); });
    document.getElementById('btnFitScreen').addEventListener('click', fitToScreen);
    document.getElementById('btnCenter').addEventListener('click', resetView);

    // Alternar VisualizaÃ§Ãµes (Tabs)
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.tab-btn').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        tabAtual = btn.dataset.tab;

        const accessibleTree = document.getElementById('accessibleTree');
        if (tabAtual === 'acessivel') {
          canvas.style.display = 'none';
          accessibleTree.classList.add('active');
          document.querySelector('.hud-controls').style.display = 'none';
          return;
        } else {
          canvas.style.display = 'flex';
          accessibleTree.classList.remove('active');
          document.querySelector('.hud-controls').style.display = 'flex';
        }

        const diagramSrc = DADOS_ARQUITETURA.diagramas[tabAtual] || DADOS_ARQUITETURA.diagramas.geral;
        await renderizarDiagrama(diagramSrc);
      });
    });

    // Clique em NÃ³s do Diagrama -> Abrir Drawer de Detalhes
    function atribuirEventosNos() {
      const nodes = canvas.querySelectorAll('.node');
      nodes.forEach(node => {
        node.style.cursor = 'pointer';
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          const nodeText = node.textContent || '';
          const encontrado = DADOS_ARQUITETURA.elementos.find(el => nodeText.includes(el.nome) || node.id.includes(el.nome));
          if (encontrado) {
            abrirDrawer(encontrado);
          } else {
            abrirDrawer({
              id: node.id,
              tipo: 'ELEMENTO',
              nome: nodeText.trim(),
              detalhes: {}
            });
          }
        });
      });
    }

    function abrirDrawer(el) {
      drawerTitle.textContent = el.nome;
      let html = '<div style="display:flex; justify-content:space-between; align-items:center;">';
      html += '<span class="badge">' + el.tipo + '</span>';
      if (el.linha) html += '<span style="font-size:0.75rem; color:var(--muted);">Linha ' + el.linha + '</span>';
      html += '</div>';

      if (el.detalhes.requisito) {
        html += '<div class="drawer-section"><h4>ðŸ“‹ Rastreio de Requisito</h4><p><code>' + el.detalhes.requisito + '</code></p></div>';
      }
      if (el.detalhes.idRegra) {
        html += '<div class="drawer-section"><h4>âš–ï¸ Identificador da Regra</h4><p><code>' + el.detalhes.idRegra + '</code></p></div>';
      }
      if (el.detalhes.idempotente) {
        html += '<div class="drawer-section"><h4>ðŸ›¡ï¸ Garantia de IdempotÃªncia</h4><p>Sim â€” OperaÃ§Ã£o com tolerÃ¢ncia total a repetiÃ§Ãµes sem efeitos colaterais.</p></div>';
      }
      if (el.detalhes.campos && el.detalhes.campos.length > 0) {
        html += '<div class="drawer-section"><h4>ðŸ“¦ Campos da Estrutura</h4><ul>';
        el.detalhes.campos.forEach(c => { html += '<li><code>' + c.nome + ': ' + c.tipo + '</code></li>'; });
        html += '</ul></div>';
      }
      if (el.detalhes.invariantes && el.detalhes.invariantes.length > 0) {
        html += '<div class="drawer-section" style="border-left:3px solid #f43f5e;"><h4>âš ï¸ Invariantes Formais</h4><ul>';
        el.detalhes.invariantes.forEach(inv => { html += '<li><code>INVARIANTE ' + inv + '</code></li>'; });
        html += '</ul></div>';
      }
      if (el.detalhes.preCondicoes && el.detalhes.preCondicoes.length > 0) {
        html += '<div class="drawer-section" style="border-left:3px solid #a78bfa;"><h4>ðŸ›¡ï¸ PrÃ©-CondiÃ§Ãµes (EXIGE)</h4><ul>';
        el.detalhes.preCondicoes.forEach(ex => { html += '<li><code>EXIGE ' + ex + '</code></li>'; });
        html += '</ul></div>';
      }
      if (el.detalhes.posCondicoes && el.detalhes.posCondicoes.length > 0) {
        html += '<div class="drawer-section" style="border-left:3px solid #34d399;"><h4>âœ… PÃ³s-CondiÃ§Ãµes (GARANTE)</h4><ul>';
        el.detalhes.posCondicoes.forEach(ga => { html += '<li><code>GARANTE ' + ga + '</code></li>'; });
        html += '</ul></div>';
      }
      if (el.detalhes.operacoes && el.detalhes.operacoes.length > 0) {
        html += '<div class="drawer-section"><h4>âš¡ OperaÃ§Ãµes</h4><ul>';
        el.detalhes.operacoes.forEach(op => {
          html += '<li><code>' + (op.idempotente ? 'IDEMPOTENTE ' : '') + op.nome + '(' + op.params + ')' + (op.retorno ? ' : ' + op.retorno : '') + '</code></li>';
        });
        html += '</ul></div>';
      }

      if (el.linha) {
        html += '<button class="btn btn-primary" style="width:100%; justify-content:center; margin-top:10px;" onclick="irParaLinha(' + el.linha + ')">ðŸŽ¯ Navegar para Linha ' + el.linha + ' no Editor</button>';
      }

      drawerContent.innerHTML = html;
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
    }

    document.getElementById('drawerClose').addEventListener('click', () => {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    });

    window.irParaLinha = function(linha) {
      vscode.postMessage({ command: 'goToLine', line: linha });
    };

    // Busca com Destaque
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const nodes = canvas.querySelectorAll('.node');
      nodes.forEach(n => {
        const txt = (n.textContent || '').toLowerCase();
        if (!q) {
          n.classList.remove('node-highlighted', 'node-dimmed');
        } else if (txt.includes(q)) {
          n.classList.add('node-highlighted');
          n.classList.remove('node-dimmed');
        } else {
          n.classList.remove('node-highlighted');
          n.classList.add('node-dimmed');
        }
      });
    });

    document.getElementById('clearSearch').addEventListener('click', () => {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
    });

    // Alto Contraste
    const btnHighContrast = document.getElementById('btnHighContrast');
    btnHighContrast.addEventListener('click', () => {
      const isHc = document.body.classList.toggle('high-contrast');
      btnHighContrast.setAttribute('aria-pressed', String(isHc));
    });

    // Copiar Mermaid
    document.getElementById('btnCopyMermaid').addEventListener('click', () => {
      const src = DADOS_ARQUITETURA.diagramas[tabAtual] || DADOS_ARQUITETURA.diagramas.geral;
      vscode.postMessage({ command: 'copyToClipboard', text: src, feedback: 'Diagrama Mermaid copiado com sucesso!' });
    });

    // Copiar Markdown
    document.getElementById('btnCopyMd').addEventListener('click', () => {
      let md = '# Arquitetura Viva â€” ' + DADOS_ARQUITETURA.nomeModulo + '\n\n';
      md += '> **DomÃ­nio:** ' + DADOS_ARQUITETURA.dominio + ' | **Camada:** ' + DADOS_ARQUITETURA.camada + ' | **SLO:** ' + DADOS_ARQUITETURA.slo + '\n\n';
      md += '\`\`\`mermaid\n' + (DADOS_ARQUITETURA.diagramas[tabAtual] || DADOS_ARQUITETURA.diagramas.geral) + '\n\`\`\`\n';
      vscode.postMessage({ command: 'copyToClipboard', text: md, feedback: 'Markdown Arquitetural copiado com sucesso!' });
    });

    // Baixar SVG
    document.getElementById('btnDownloadSvg').addEventListener('click', () => {
      const svg = canvas.querySelector('svg');
      if (!svg) return;
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svg);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'arquitetura_' + DADOS_ARQUITETURA.nomeModulo + '.svg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    // Atalhos de Teclado Globais
    window.addEventListener('keydown', (e) => {
      if (document.activeElement === searchInput) {
        if (e.key === 'Escape') searchInput.blur();
        return;
      }
      if (e.key === '+' || e.key === '=') zoom(0.2);
      else if (e.key === '-' || e.key === '_') zoom(-0.2);
      else if (e.key === '0') { scale = 1; aplicarTransform(); }
      else if (e.key === 'f' || e.key === 'F') fitToScreen();
      else if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') { panY += 40; aplicarTransform(); }
      else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') { panY -= 40; aplicarTransform(); }
      else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') { panX += 40; aplicarTransform(); }
      else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') { panX -= 40; aplicarTransform(); }
      else if (e.key === '/' || (e.ctrlKey && e.key === 'f')) {
        e.preventDefault();
        searchInput.focus();
      } else if (e.key === 'Escape') {
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
      }
    });

    // InicializaÃ§Ã£o
    setTimeout(async () => {
      await renderizarDiagrama(DADOS_ARQUITETURA.diagramas.geral);
    }, 100);
  </script>
</body>
</html>`;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('thz.previewArchitecture', () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        vscode.window.showInformationMessage('Abra um arquivo .thz para visualizar a arquitetura.');
        return;
      }

      if (architecturePanel) {
        architecturePanel.reveal(vscode.ViewColumn.Beside);
      } else {
        architecturePanel = vscode.window.createWebviewPanel(
          'thzArchitecture',
          'THZ Arquitetura Viva',
          vscode.ViewColumn.Beside,
          { enableScripts: true, retainContextWhenHidden: true }
        );
        architecturePanel.onDidDispose(() => {
          architecturePanel = undefined;
        });

        // Receptor de Mensagens do Webview (NavegaÃ§Ã£o ao cÃ³digo, cÃ³pia, etc)
        architecturePanel.webview.onDidReceiveMessage(message => {
          if (message.command === 'goToLine') {
            const linha = message.line;
            const editorAtivo = vscode.window.activeTextEditor;
            if (editorAtivo && linha > 0) {
              const pos = new vscode.Position(linha - 1, 0);
              editorAtivo.selection = new vscode.Selection(pos, pos);
              editorAtivo.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
          } else if (message.command === 'copyToClipboard') {
            vscode.env.clipboard.writeText(message.text || '');
            if (message.feedback) {
              vscode.window.showInformationMessage(message.feedback);
            }
          }
        });
      }

      architecturePanel.webview.html = renderizarHtmlArquitetura(ed.document.getText());
    })
  );

  // AtualizaÃ§Ã£o com debounce do Live Preview de Arquitetura
  let timerAtualizacaoPreview: NodeJS.Timeout | undefined;
  vscode.workspace.onDidChangeTextDocument(e => {
    if (architecturePanel && e.document === vscode.window.activeTextEditor?.document && e.document.languageId === 'thz') {
      if (timerAtualizacaoPreview) clearTimeout(timerAtualizacaoPreview);
      timerAtualizacaoPreview = setTimeout(() => {
        if (architecturePanel) {
          architecturePanel.webview.html = renderizarHtmlArquitetura(e.document.getText());
        }
      }, 400);
    }
  });

  // ==========================================================================
  // 4. LIVE PREVIEW DE TELAS DECLARATIVAS (.thzui / PROGRAMA VISUAL)
  // ==========================================================================

  let uiPanel: vscode.WebviewPanel | undefined;

  function renderizarHtmlTelaDeclarativa(fonte: string): string {
    let titulo = 'Interface Declarativa';
    const mNome = fonte.match(/(?:PROGRAMA VISUAL|TELA|PROGRAMA)\s+([A-Za-z0-9_]+)/);
    if (mNome) titulo = mNome[1];

    const botoes: string[] = [];
    const campos: { nome: string; tipo: string }[] = [];

    const linhas = fonte.split(/\r?\n/);
    for (const l of linhas) {
      const mBtn = l.match(/^\s*(?:BOTAO|botao|btn)\s*\(\s*"([^"]+)"/i) || l.match(/PROCEDIMENTO\s+([A-Za-z0-9_]+)/);
      if (mBtn && !botoes.includes(mBtn[1])) botoes.push(mBtn[1]);

      const mCampo = l.match(/^\s*([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_()]+)/);
      if (mCampo && !l.includes('DOMINIO') && !l.includes('CAMADA') && !l.includes('SLO') && !l.includes('VERSAO')) {
        campos.push({ nome: mCampo[1], tipo: mCampo[2] });
      }
    }

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>THZ UI Live Preview</title>
  <style>
    :root {
      --bg: #090d16;
      --card: rgba(22, 31, 49, 0.85);
      --border: rgba(255, 255, 255, 0.12);
      --primary: #3b82f6;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Inter, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 24px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
    .window-card { width: 100%; max-width: 600px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; backdrop-filter: blur(16px); box-shadow: 0 20px 40px rgba(0,0,0,0.5); overflow: hidden; }
    .window-header { padding: 14px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; background: rgba(15, 23, 42, 0.6); }
    .window-header h2 { font-size: 1rem; font-weight: 600; color: var(--text); }
    .badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 99px; background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
    .window-body { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .form-group label { font-size: 0.85rem; color: var(--muted); font-weight: 500; }
    .form-input { padding: 10px 14px; background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.9rem; outline: none; }
    .form-input:focus { border-color: var(--primary); }
    .btn-group { display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
    .btn { padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 0.9rem; border: none; cursor: pointer; transition: all 0.2s ease; }
    .btn-primary { background: var(--primary); color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: rgba(255, 255, 255, 0.08); color: var(--text); border: 1px solid var(--border); }
    .output-log { margin-top: 20px; width: 100%; max-width: 600px; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 8px; font-family: monospace; font-size: 0.8rem; color: var(--muted); }
  </style>
</head>
<body>
  <div class="window-card">
    <div class="window-header">
      <h2>ðŸ–¥ï¸ ${titulo}</h2>
      <span class="badge">Live Preview Glassmorphism</span>
    </div>
    <div class="window-body">
      ${campos.length > 0 ? campos.map(c => `
        <div class="form-group">
          <label>${c.nome} <span style="font-size:0.75rem; color:var(--muted)">(${c.tipo})</span></label>
          <input class="form-input" placeholder="Informe ${c.nome}..." />
        </div>
      `).join('') : '<p style="color:var(--muted); font-size:0.9rem">Nenhum campo de entrada declarado.</p>'}
      
      <div class="btn-group">
        ${botoes.length > 0 ? botoes.map((b, idx) => `
          <button class="btn ${idx === 0 ? 'btn-primary' : 'btn-secondary'}" onclick="registrarClique('${b}')">â–¶ ${b}</button>
        `).join('') : '<button class="btn btn-primary">â–¶ Executar AÃ§Ã£o</button>'}
      </div>
    </div>
  </div>
  <div class="output-log" id="log">Console Interativo: Pronto.</div>
  <script>
    function registrarClique(nome) {
      document.getElementById('log').textContent = 'Evento disparado: ' + nome + ' em ' + new Date().toLocaleTimeString();
    }
  </script>
</body>
</html>`;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('thz.previewUi', () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        vscode.window.showInformationMessage('Abra um arquivo .thz ou .thzui para visualizar a tela declarativa.');
        return;
      }

      if (uiPanel) {
        uiPanel.reveal(vscode.ViewColumn.Beside);
      } else {
        uiPanel = vscode.window.createWebviewPanel(
          'thzUiPreview',
          'THZ UI Preview',
          vscode.ViewColumn.Beside,
          { enableScripts: true, retainContextWhenHidden: true }
        );
        uiPanel.onDidDispose(() => {
          uiPanel = undefined;
        });
      }

      uiPanel.webview.html = renderizarHtmlTelaDeclarativa(ed.document.getText());
    })
  );

  vscode.workspace.onDidChangeTextDocument(e => {
    if (uiPanel && e.document === vscode.window.activeTextEditor?.document) {
      uiPanel.webview.html = renderizarHtmlTelaDeclarativa(e.document.getText());
    }
  });

  // ==========================================================================
  // 5. COCKPIT THZ â€” SUÃTE DE COMANDO & ARQUITETURA VIVA (ACTIVITY BAR)
  // ==========================================================================

  class ThzCockpitItem extends vscode.TreeItem {
    constructor(
      public readonly label: string,
      public readonly collapsibleState: vscode.TreeItemCollapsibleState,
      public readonly description?: string,
      public readonly iconThemeName?: string,
      public readonly commandAction?: vscode.Command,
      public readonly tooltipText?: string | vscode.MarkdownString,
      public readonly children?: ThzCockpitItem[]
    ) {
      super(label, collapsibleState);
      this.description = description;
      if (iconThemeName) {
        this.iconPath = new vscode.ThemeIcon(iconThemeName);
      }
      this.command = commandAction;
      if (tooltipText) {
        this.tooltip = tooltipText;
      }
    }
  }

  // 5.1 Provider de AÃ§Ãµes RÃ¡pidas do Cockpit
  class ThzCockpitActionsProvider implements vscode.TreeDataProvider<ThzCockpitItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ThzCockpitItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
      this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ThzCockpitItem): vscode.TreeItem {
      return element;
    }

    getChildren(element?: ThzCockpitItem): Thenable<ThzCockpitItem[]> {
      if (element) return Promise.resolve(element.children || []);

      const items: ThzCockpitItem[] = [
        new ThzCockpitItem(
          'Executar Programa Atual',
          vscode.TreeItemCollapsibleState.None,
          'thz run',
          'play',
          { command: 'thz.run', title: 'Executar Programa' },
          'Executa o arquivo .thz ativo no terminal integrado'
        ),
        new ThzCockpitItem(
          'Verificar CÃ³digo & Contratos',
          vscode.TreeItemCollapsibleState.None,
          'thz check',
          'check',
          { command: 'thz.check', title: 'Verificar CÃ³digo' },
          'Executa anÃ¡lise sintÃ¡tica, semÃ¢ntica e verificaÃ§Ã£o formal de contratos'
        ),
        new ThzCockpitItem(
          'Live Preview de Arquitetura Viva',
          vscode.TreeItemCollapsibleState.None,
          'Mermaid / DDD',
          'graph',
          { command: 'thz.previewArchitecture', title: 'Live Preview de Arquitetura' },
          'Abre visualizador interativo com Pan, Zoom e Diagramas C4/DDD'
        ),
        new ThzCockpitItem(
          'Live Preview de Tela Declarativa',
          vscode.TreeItemCollapsibleState.None,
          '.thzui / GUI',
          'browser',
          { command: 'thz.previewUi', title: 'Live Preview de Tela' },
          'Abre prÃ©-visualizaÃ§Ã£o em tempo real de interfaces declarativas'
        ),
        new ThzCockpitItem(
          'Auditoria de GovernanÃ§a',
          vscode.TreeItemCollapsibleState.None,
          'ISO 42010 / SOX',
          'shield',
          { command: 'thz.showAudit', title: 'Auditoria de GovernanÃ§a' },
          'Gera relatÃ³rio completo de rastreabilidade, SLOs e conformidade'
        ),
        new ThzCockpitItem(
          'Inspecionar IR IntermediÃ¡rio',
          vscode.TreeItemCollapsibleState.None,
          'thz-ir/1 JSON',
          'symbol-structure',
          { command: 'thz.showIr', title: 'Mostrar IR' },
          'Exibe a representaÃ§Ã£o intermediÃ¡ria formal (IR) da compilaÃ§Ã£o'
        ),
        new ThzCockpitItem(
          'Inspecionar LLVM IR',
          vscode.TreeItemCollapsibleState.None,
          'Clang AOT',
          'file-binary',
          { command: 'thz.showLlvm', title: 'Mostrar LLVM IR' },
          'Exibe o cÃ³digo LLVM nativo de alta performance gerado pelo compilador'
        ),
        new ThzCockpitItem(
          'Abrir Desktop IDE Oficial',
          vscode.TreeItemCollapsibleState.None,
          'Swing FlatLaf',
          'window',
          { command: 'thz.openGui', title: 'Abrir Desktop IDE' },
          'Inicia a IDE desktop nativa universal THZ-LANG'
        ),
        new ThzCockpitItem(
          'Iniciar REPL Interativo',
          vscode.TreeItemCollapsibleState.None,
          'Console REPL',
          'terminal',
          { command: 'thz.openRepl', title: 'Abrir REPL' },
          'Abre ambiente interativo linha a linha no terminal'
        )
      ];

      return Promise.resolve(items);
    }
  }

  // 5.2 Provider de Outline Interativo de GovernanÃ§a & Arquitetura
  class ThzOutlineTreeDataProvider implements vscode.TreeDataProvider<ThzCockpitItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ThzCockpitItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
      this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ThzCockpitItem): vscode.TreeItem {
      return element;
    }

    getChildren(element?: ThzCockpitItem): Thenable<ThzCockpitItem[]> {
      if (element) {
        return Promise.resolve(element.children || []);
      }

      const ed = vscode.window.activeTextEditor;
      const isThzFile = ed && (
        ed.document.languageId === 'thz' ||
        ed.document.fileName.endsWith('.thz') ||
        ed.document.fileName.endsWith('.thzui')
      );

      if (!ed || !isThzFile) {
        return Promise.resolve([
          new ThzCockpitItem(
            'Nenhum arquivo .thz ativo',
            vscode.TreeItemCollapsibleState.None,
            'Abra um arquivo .thz para ver o outline',
            'info',
            undefined,
            'Abra um arquivo .thz ou escolha um exemplo na Galeria abaixo.'
          )
        ]);
      }

      const fonte = ed.document.getText();
      const filePath = ed.document.uri.fsPath;
      const linhas = fonte.split(/\r?\n/);
      const items: ThzCockpitItem[] = [];

      // ExtraÃ§Ã£o de Metadados
      const metaChildren: ThzCockpitItem[] = [];
      const mMod = fonte.match(/(?:(PROGRAMA(?:\s+VISUAL|\s+NEGOCIO|\s+ARQUITETURA)?|BIBLIOTECA|EXTENSAO|FERRAMENTA|TESTE))\s+([A-Za-z0-9_]+)/);
      if (mMod) metaChildren.push(new ThzCockpitItem('MÃ³dulo', vscode.TreeItemCollapsibleState.None, mMod[2] + ` (${mMod[1]})`, 'package', { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [1, filePath] }));
      const mDom = fonte.match(/DOMINIO\s*:\s*"([^"]+)"/);
      if (mDom) metaChildren.push(new ThzCockpitItem('DomÃ­nio', vscode.TreeItemCollapsibleState.None, mDom[1], 'organization'));
      const mCam = fonte.match(/CAMADA\s*:\s*"([^"]+)"/);
      if (mCam) metaChildren.push(new ThzCockpitItem('Camada', vscode.TreeItemCollapsibleState.None, mCam[1], 'layers'));
      const mSlo = fonte.match(/SLO_LATENCIA_MAXIMA\s*:\s*"([^"]+)"/);
      if (mSlo) metaChildren.push(new ThzCockpitItem('SLO de LatÃªncia', vscode.TreeItemCollapsibleState.None, mSlo[1], 'watch'));
      const mCrit = fonte.match(/CRITICIDADE\s*:\s*"([^"]+)"/);
      if (mCrit) metaChildren.push(new ThzCockpitItem('Criticidade', vscode.TreeItemCollapsibleState.None, mCrit[1], 'alert'));
      const mAut = fonte.match(/AUTOR\s*:\s*"([^"]+)"/);
      if (mAut) metaChildren.push(new ThzCockpitItem('Autor', vscode.TreeItemCollapsibleState.None, mAut[1], 'person'));
      const mConf = fonte.match(/CONFORMIDADE\s*:\s*"([^"]+)"/);
      if (mConf) metaChildren.push(new ThzCockpitItem('Conformidade', vscode.TreeItemCollapsibleState.None, mConf[1], 'verified'));

      if (metaChildren.length > 0) {
        items.push(new ThzCockpitItem('ðŸ›ï¸ Metadados de Arquitetura (ISO 42010)', vscode.TreeItemCollapsibleState.Expanded, `${metaChildren.length} atributo(s)`, 'circuit-board', undefined, undefined, metaChildren));
      }

      // ExtraÃ§Ã£o de Estruturas
      const estrChildren: ThzCockpitItem[] = [];
      let estAtual: { nome: string; linha: number; soa: boolean; campos: ThzCockpitItem[]; invariantes: ThzCockpitItem[] } | null = null;

      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        const numLinha = i + 1;

        const mE = l.match(/^\s*ESTRUTURA\s+([A-Za-z0-9_]+)(?:\s+(LAYOUT_COLUNAR))?/);
        if (mE) {
          estAtual = { nome: mE[1], linha: numLinha, soa: !!mE[2], campos: [], invariantes: [] };
        }
        if (estAtual) {
          const mCampo = l.match(/^\s*([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_<>[\]]+)/);
          if (mCampo && !l.includes('ESTRUTURA') && !l.includes('INVARIANTE')) {
            estAtual.campos.push(new ThzCockpitItem(mCampo[1], vscode.TreeItemCollapsibleState.None, mCampo[2], 'symbol-field', { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }));
          }
          const mInv = l.match(/^\s*INVARIANTE\s+(.+)/);
          if (mInv) {
            estAtual.invariantes.push(new ThzCockpitItem(`INVARIANTE ${mInv[1].trim()}`, vscode.TreeItemCollapsibleState.None, 'Regra de Validade', 'shield', { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }));
          }
          if (l.match(/^\s*FIM_ESTRUTURA/)) {
            const subItens = [...estAtual.campos, ...estAtual.invariantes];
            const tag = estAtual.soa ? 'SoA / SIMD' : `${estAtual.campos.length} campo(s)`;
            estrChildren.push(new ThzCockpitItem(
              `ðŸ“¦ ${estAtual.nome}`,
              subItens.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
              tag,
              'symbol-structure',
              { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [estAtual.linha, filePath] },
              `Estrutura de dados ${estAtual.nome} (${estAtual.soa ? 'Layout Colunar SIMD' : 'Layout PadrÃ£o'})`,
              subItens
            ));
            estAtual = null;
          }
        }
      }
      if (estrChildren.length > 0) {
        items.push(new ThzCockpitItem('ðŸ“¦ Entidades & Estruturas de Dados', vscode.TreeItemCollapsibleState.Expanded, `${estrChildren.length} modelo(s)`, 'database', undefined, undefined, estrChildren));
      }

      // ExtraÃ§Ã£o de Regras e Contratos DDD
      const regrasChildren: ThzCockpitItem[] = [];
      let regraAtual: { nome: string; linha: number; req?: string; idRegra?: string; idemp?: boolean; subItens: ThzCockpitItem[] } | null = null;

      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        const numLinha = i + 1;

        const mR = l.match(/^\s*REGRA_NEGOCIO\s+([A-Za-z0-9_]+)/);
        if (mR) {
          regraAtual = { nome: mR[1], linha: numLinha, subItens: [] };
        }
        if (regraAtual) {
          const mBr = l.match(/IDENTIFICADOR_REGRA\s*:\s*"([^"]+)"/);
          if (mBr) regraAtual.idRegra = mBr[1];
          const mReq = l.match(/RASTREIO_REQUISITO\s*:\s*"([^"]+)"/);
          if (mReq) {
            regraAtual.req = mReq[1];
            regraAtual.subItens.push(new ThzCockpitItem(`ðŸ“‹ Requisito: ${mReq[1]}`, vscode.TreeItemCollapsibleState.None, 'Rastreabilidade', 'bookmark', { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }));
          }
          const mIdemp = l.match(/IDEMPOTENTE/);
          if (mIdemp) {
            regraAtual.idemp = true;
            regraAtual.subItens.push(new ThzCockpitItem('ðŸ›¡ï¸ Garantia: IDEMPOTENTE', vscode.TreeItemCollapsibleState.None, 'TolerÃ¢ncia a RepetiÃ§Ãµes', 'shield', { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }));
          }
          const mExige = l.match(/^\s*EXIGE\s+(.+)/);
          if (mExige) {
            regraAtual.subItens.push(new ThzCockpitItem(`ðŸ›¡ï¸ EXIGE ${mExige[1].trim()}`, vscode.TreeItemCollapsibleState.None, 'PrÃ©-CondiÃ§Ã£o', 'lock', { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }));
          }
          const mGarante = l.match(/^\s*GARANTE\s+(.+)/);
          if (mGarante) {
            regraAtual.subItens.push(new ThzCockpitItem(`âœ… GARANTE ${mGarante[1].trim()}`, vscode.TreeItemCollapsibleState.None, 'PÃ³s-CondiÃ§Ã£o', 'pass-filled', { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }));
          }
          const mOp = l.match(/^\s*OPERACAO\s+(?:(IDEMPOTENTE)\s+)?([A-Za-z0-9_]+)\s*\((.*?)\)(?:\s*:\s*([A-Za-z0-9_<>[\]]+))?/);
          if (mOp) {
            regraAtual.subItens.push(new ThzCockpitItem(`âš¡ ${mOp[2]}(${mOp[3] || ''})`, vscode.TreeItemCollapsibleState.None, mOp[4] || 'void', 'symbol-method', { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }));
          }

          if (l.match(/^\s*FIM_REGRA_NEGOCIO/)) {
            const desc = [regraAtual.idRegra, regraAtual.req].filter(Boolean).join(' | ') || `${regraAtual.subItens.length} contrato(s)`;
            regrasChildren.push(new ThzCockpitItem(
              `âš–ï¸ ${regraAtual.nome}`,
              regraAtual.subItens.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
              desc,
              'law',
              { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [regraAtual.linha, filePath] },
              `Regra de NegÃ³cio DDD ${regraAtual.nome}`,
              regraAtual.subItens
            ));
            regraAtual = null;
          }
        }
      }
      if (regrasChildren.length > 0) {
        items.push(new ThzCockpitItem('âš–ï¸ Regras de NegÃ³cio & Contratos (DDD)', vscode.TreeItemCollapsibleState.Expanded, `${regrasChildren.length} regra(s)`, 'shield', undefined, undefined, regrasChildren));
      }

      // ExtraÃ§Ã£o de Procedimentos Globais
      const procsChildren: ThzCockpitItem[] = [];
      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        const numLinha = i + 1;
        const mProc = l.match(/^\s*PROCEDIMENTO\s+(?:(IDEMPOTENTE)\s+)?([A-Za-z0-9_]+)\s*\((.*?)\)/);
        if (mProc) {
          procsChildren.push(new ThzCockpitItem(
            `ðŸš€ ${mProc[2]}(${mProc[3] || ''})`,
            vscode.TreeItemCollapsibleState.None,
            mProc[1] ? 'ðŸ›¡ï¸ IDEMPOTENTE' : 'Procedimento',
            'symbol-method',
            { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }
          ));
        }
      }
      if (procsChildren.length > 0) {
        items.push(new ThzCockpitItem('ðŸš€ Procedimentos de ExecuÃ§Ã£o', vscode.TreeItemCollapsibleState.Expanded, `${procsChildren.length} procedimento(s)`, 'run', undefined, undefined, procsChildren));
      }

      // ExtraÃ§Ã£o de Pipelines
      const pipeChildren: ThzCockpitItem[] = [];
      let pipeAtual: { nome: string; linha: number; subItens: ThzCockpitItem[] } | null = null;
      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        const numLinha = i + 1;
        const mPipe = l.match(/^\s*PIPELINE_DADOS\s+([A-Za-z0-9_]+)/);
        if (mPipe) {
          pipeAtual = { nome: mPipe[1], linha: numLinha, subItens: [] };
        }
        if (pipeAtual) {
          const mFonte = l.match(/FONTE_ENTRADA\s*:\s*(.+)/);
          if (mFonte) pipeAtual.subItens.push(new ThzCockpitItem(`ðŸ“¥ Entrada: ${mFonte[1].trim()}`, vscode.TreeItemCollapsibleState.None, undefined, 'arrow-down'));
          const mTransf = l.match(/TRANSFORMACAO\s*:\s*(.+)/);
          if (mTransf) pipeAtual.subItens.push(new ThzCockpitItem(`âš™ï¸ Transform: ${mTransf[1].trim()}`, vscode.TreeItemCollapsibleState.None, undefined, 'gear'));
          const mDest = l.match(/DESTINO_SAIDA\s*:\s*(.+)/);
          if (mDest) pipeAtual.subItens.push(new ThzCockpitItem(`ðŸ“¤ SaÃ­da: ${mDest[1].trim()}`, vscode.TreeItemCollapsibleState.None, undefined, 'arrow-up'));
          if (l.match(/^\s*FIM_PIPELINE/)) {
            pipeChildren.push(new ThzCockpitItem(
              `ðŸ”„ Pipeline: ${pipeAtual.nome}`,
              pipeAtual.subItens.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
              undefined,
              'sync',
              { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [pipeAtual.linha, filePath] },
              undefined,
              pipeAtual.subItens
            ));
            pipeAtual = null;
          }
        }
      }
      if (pipeChildren.length > 0) {
        items.push(new ThzCockpitItem('ðŸ”„ Pipelines de Dados', vscode.TreeItemCollapsibleState.Expanded, `${pipeChildren.length} pipeline(s)`, 'sync', undefined, undefined, pipeChildren));
      }

      // ExtraÃ§Ã£o de EnumeraÃ§Ãµes
      const enumChildren: ThzCockpitItem[] = [];
      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        const numLinha = i + 1;
        const mEnum = l.match(/^\s*ENUMERACAO\s+([A-Za-z0-9_]+)/);
        if (mEnum) {
          const vals = l.includes(':') ? l.split(':')[1].split(',').map(s => s.trim()).join(' | ') : '';
          enumChildren.push(new ThzCockpitItem(
            `ðŸ“‘ ${mEnum[1]}`,
            vscode.TreeItemCollapsibleState.None,
            vals,
            'symbol-enum',
            { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }
          ));
        }
      }
      if (enumChildren.length > 0) {
        items.push(new ThzCockpitItem('ðŸ“‘ EnumeraÃ§Ãµes de DomÃ­nio', vscode.TreeItemCollapsibleState.Collapsed, `${enumChildren.length} enum(s)`, 'symbol-enum', undefined, undefined, enumChildren));
      }

      // ExtraÃ§Ã£o de Telas (.thzui / PROGRAMA VISUAL)
      const uiChildren: ThzCockpitItem[] = [];
      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i];
        const numLinha = i + 1;
        const mBtn = l.match(/^\s*(?:BOTAO|botao|btn)\s*\(\s*"([^"]+)"/i);
        if (mBtn) uiChildren.push(new ThzCockpitItem(`ðŸ”˜ BotÃ£o "${mBtn[1]}"`, vscode.TreeItemCollapsibleState.None, undefined, 'symbol-event', { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }));
        const mTela = l.match(/^\s*(?:TELA|PROGRAMA VISUAL)\s+([A-Za-z0-9_]+)/);
        if (mTela) uiChildren.push(new ThzCockpitItem(`ðŸ–¼ï¸ Tela: ${mTela[1]}`, vscode.TreeItemCollapsibleState.None, undefined, 'browser', { command: 'thz.gotoLine', title: 'Ir para Linha', arguments: [numLinha, filePath] }));
      }
      if (uiChildren.length > 0) {
        items.push(new ThzCockpitItem('ðŸŽ¨ Interfaces Declarativas (UI)', vscode.TreeItemCollapsibleState.Expanded, `${uiChildren.length} componente(s)`, 'browser', undefined, undefined, uiChildren));
      }

      return Promise.resolve(items);
    }
  }

  // 5.3 Provider de Galeria de Exemplos
  class ThzGalleryTreeDataProvider implements vscode.TreeDataProvider<ThzCockpitItem> {
    getTreeItem(element: ThzCockpitItem): vscode.TreeItem {
      return element;
    }

    getChildren(): Thenable<ThzCockpitItem[]> {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        return Promise.resolve([new ThzCockpitItem('Nenhum workspace aberto', vscode.TreeItemCollapsibleState.None)]);
      }

      function resolverExemplo(subPath: string): string {
        const cands = [
          path.join(workspaceFolder, 'exemplos', subPath),
          path.join(workspaceFolder, 'thz-lang', 'exemplos', subPath),
          path.resolve(workspaceFolder, '..', 'thz-lang', 'exemplos', subPath)
        ];
        return cands.find(c => fs.existsSync(c)) || cands[0];
      }

      const exemplosDefinidos = [
        { label: 'ðŸ’¼ Faturamento em Lote (SoA/SIMD)', path: resolverExemplo('faturamento.thz'), desc: 'faturamento.thz' },
        { label: 'ðŸ›’ GestÃ£o de Pedidos & DDD', path: resolverExemplo('pedidos.thz'), desc: 'pedidos.thz' },
        { label: 'ðŸŽ¨ Showcase de Widgets GUI', path: resolverExemplo('showcase_widgets_gui.thz'), desc: 'showcase_widgets_gui.thz' },
        { label: 'ðŸ’³ Simulador de CrÃ©dito & FinanÃ§as', path: resolverExemplo('simulador_credito_gui.thz'), desc: 'simulador_credito_gui.thz' },
        { label: 'ðŸ·ï¸ THZ Studio IDE Declarativo', path: resolverExemplo('thz_studio_ide.thzui'), desc: 'thz_studio_ide.thzui' },
        { label: 'ðŸ“¦ PadrÃ£o Result DDD', path: resolverExemplo(path.join('colecao', '07-resultado-ddd.thz')), desc: '07-resultado-ddd.thz' },
        { label: 'âš¡ VetorizaÃ§Ã£o SIMD (AVX2/512)', path: resolverExemplo(path.join('colecao', '08-vetorizado-simd.thz')), desc: '08-vetorizado-simd.thz' },
        { label: 'ðŸ›¡ï¸ IdempotÃªncia em Larga Escala', path: resolverExemplo(path.join('colecao', '11-idempotencia-larga-escala.thz')), desc: '11-idempotencia-larga-escala.thz' }
      ];

      const items = exemplosDefinidos.map(ex => {
        const existe = fs.existsSync(ex.path);
        return new ThzCockpitItem(
          ex.label,
          vscode.TreeItemCollapsibleState.None,
          existe ? ex.desc : '(nÃ£o encontrado)',
          'file-code',
          existe ? { command: 'thz.openFile', title: 'Abrir Exemplo', arguments: [ex.path] } : undefined,
          `Clique para abrir ${ex.desc} no editor`
        );
      });

      return Promise.resolve(items);
    }
  }

  // 5.4 Provider de Status do Ambiente & Runtime
  class ThzEnvironmentTreeDataProvider implements vscode.TreeDataProvider<ThzCockpitItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ThzCockpitItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
      this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ThzCockpitItem): vscode.TreeItem {
      return element;
    }

    getChildren(): Thenable<ThzCockpitItem[]> {
      const isEstrito = vscode.workspace.getConfiguration('thz-lang').get<boolean>('lintEstrito', false);

      const items: ThzCockpitItem[] = [
        new ThzCockpitItem('VersÃ£o do Engine', vscode.TreeItemCollapsibleState.None, 'THZ-LANG ﻿0.4.0', 'tag'),
        new ThzCockpitItem('Language Server (LSP)', vscode.TreeItemCollapsibleState.None, client ? 'Conectado (Java 25)' : 'Inativo', 'server-process'),
        new ThzCockpitItem('Backend de CompilaÃ§Ã£o', vscode.TreeItemCollapsibleState.None, 'LLVM Clang AOT / GraalVM', 'zap'),
        new ThzCockpitItem('Gerenciamento de MemÃ³ria', vscode.TreeItemCollapsibleState.None, 'Arena ContÃ­gua O(1) (ISO TR 24772)', 'layers'),
        new ThzCockpitItem('AritmÃ©tica Decimais', vscode.TreeItemCollapsibleState.None, 'ISO/IEC 10967 (DecimalFixo Half-Even)', 'shield'),
        new ThzCockpitItem(
          'Modo Estrito (Lint Restritivo)',
          vscode.TreeItemCollapsibleState.None,
          isEstrito ? 'Ativado ðŸ›¡ï¸' : 'Desativado (Clique para alternar)',
          isEstrito ? 'pass-filled' : 'circle-outline',
          { command: 'thz.toggleLintEstrito', title: 'Alternar Modo Estrito' },
          'Exige metadados ISO 42010, SLO de latÃªncia, contratos EXIGE/GARANTE e rastreabilidade'
        )
      ];

      return Promise.resolve(items);
    }
  }

  // Registro das Ãrvores e AtualizaÃ§Ãµes
  const cockpitActionsProvider = new ThzCockpitActionsProvider();
  const outlineProvider = new ThzOutlineTreeDataProvider();
  const galleryProvider = new ThzGalleryTreeDataProvider();
  const environmentProvider = new ThzEnvironmentTreeDataProvider();

  vscode.window.registerTreeDataProvider('thz-cockpit-view', cockpitActionsProvider);
  vscode.window.registerTreeDataProvider('thz-governance-view', outlineProvider);
  vscode.window.registerTreeDataProvider('thz-gallery-view', galleryProvider);
  vscode.window.registerTreeDataProvider('thz-environment-view', environmentProvider);

  function atualizarCockpit(): void {
    cockpitActionsProvider.refresh();
    outlineProvider.refresh();
    environmentProvider.refresh();
  }

  vscode.window.onDidChangeActiveTextEditor(() => atualizarCockpit());
  vscode.workspace.onDidChangeTextDocument(e => {
    if (e.document === vscode.window.activeTextEditor?.document) {
      outlineProvider.refresh();
    }
  });

  // Comandos auxiliares de navegaÃ§Ã£o do Cockpit
  context.subscriptions.push(
    vscode.commands.registerCommand('thz.refreshCockpit', () => atualizarCockpit()),

    vscode.commands.registerCommand('thz.gotoLine', async (linha: number, filePath?: string) => {
      let ed = vscode.window.activeTextEditor;
      if (filePath && (!ed || ed.document.uri.fsPath !== filePath)) {
        const doc = await vscode.workspace.openTextDocument(filePath);
        ed = await vscode.window.showTextDocument(doc);
      }
      if (ed && linha > 0) {
        const pos = new vscode.Position(linha - 1, 0);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    }),

    vscode.commands.registerCommand('thz.openFile', async (filePath: string) => {
      if (fs.existsSync(filePath)) {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
      } else {
        vscode.window.showWarningMessage('Arquivo nÃ£o encontrado: ' + filePath);
      }
    }),

    vscode.commands.registerCommand('thz.toggleLintEstrito', async () => {
      const cfg = vscode.workspace.getConfiguration('thz-lang');
      const atual = cfg.get<boolean>('lintEstrito', false);
      await cfg.update('lintEstrito', !atual, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Modo Estrito THZ-LANG: ${!atual ? 'ATIVADO ðŸ›¡ï¸' : 'DESATIVADO'}`);
      environmentProvider.refresh();
    })
  );

  // ==========================================================================
  // 6. ENDPOINTS CUSTOMIZADOS LSP (Auditoria / IR / LLVM)
  // ==========================================================================

  context.subscriptions.push(
    vscode.commands.registerCommand('thz.showAudit', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        vscode.window.showInformationMessage('Abra um arquivo .thz para auditar.');
        return;
      }
      try {
        const result: any = await client!.sendRequest('thz/audit', { uri: ed.document.uri.toString() });
        if (result?.markdown) {
          const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: result.markdown });
          await vscode.window.showTextDocument(doc, { preview: true });
        } else if (result?.error) {
          vscode.window.showErrorMessage(result.error);
        }
      } catch (e) {
        vscode.window.showErrorMessage('Falha na auditoria: ' + (e as Error).message);
      }
    }),
    vscode.commands.registerCommand('thz.showIr', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      try {
        const res: any = await client!.sendRequest('thz/ir', { uri: ed.document.uri.toString() });
        if (res?.text) {
          const doc = await vscode.workspace.openTextDocument({ language: 'json', content: res.text });
          await vscode.window.showTextDocument(doc, { preview: true });
        } else if (res?.error) {
          vscode.window.showErrorMessage(res.error);
        }
      } catch (e) {
        vscode.window.showErrorMessage('Falha ao gerar IR: ' + (e as Error).message);
      }
    }),
    vscode.commands.registerCommand('thz.showLlvm', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      try {
        const res: any = await client!.sendRequest('thz/llvm', { uri: ed.document.uri.toString() });
        if (res?.text) {
          const doc = await vscode.workspace.openTextDocument({ language: 'llvm', content: res.text });
          await vscode.window.showTextDocument(doc, { preview: true });
        } else if (res?.error) {
          vscode.window.showErrorMessage(res.error);
        }
      } catch (e) {
        vscode.window.showErrorMessage('Falha ao gerar LLVM IR: ' + (e as Error).message);
      }
    })
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

