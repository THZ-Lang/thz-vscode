# THZ-LANG — VS Code & Antigravity IDE Extension

Extensão oficial para **Visual Studio Code**, **Antigravity IDE** e ambientes compatíveis com TextMate / Language Server Protocol (LSP), trazendo suporte completo de desenvolvimento e depuração para **THZ-LANG** (`.thz`, `.thzui`).

---

## 🌟 Funcionalidades

| Recurso | Descrição |
|---|---|
| **Realce Léxico Completo** | Gramática TextMate com suporte à sintaxe corporativa canônica e ao paradigma dual moderno (`fn`, `struct`, `var`, `val`, `{ ... }`, `print`, `ret`), além de comentários `//`, `#` e `/* */` |
| **Diagnósticos em Tempo Real** | Validação sintática e semântica imediata alimentada pelo servidor LSP Java 25 (`[Linha L:C]`) com suporte ao modo `--estrito` |
| **Depurador Nativo (DAP)** | Suporte integrado ao Debug Adapter Protocol com pontos de interrupção (*breakpoints*), passo a passo (*step over/into*), call stack e inspeção de variáveis |
| **Hover & Assinaturas** | Tipagem estática, parâmetros de funções/estruturas, cláusulas de contrato `EXIGE`/`GARANTE` e stdlib |
| **Autocompletion Contextual** | Palavras-chave corporativas e modernas, tipos nativos, aliases (`Int`, `Decimal`, `Money`, `String`) e snippets de código |
| **Navegação de Símbolos** | Outline hierárquico com `DocumentSymbol`, *Go-to-Definition* e busca de símbolos no workspace |
| **Formatação Canônica** | Formatação idempotente automática ao salvar (`editor.formatOnSave`) ou via atalho `Shift+Alt+F` |
| **Governança & IR** | Comandos integrados na Command Palette (`Ctrl+Shift+P`): `THZ: Mostrar Auditoria de Governança`, `THZ: Mostrar IR` e `THZ: Mostrar LLVM IR` |

---

## 🚀 Como Gerar e Instalar o Pacote `.vsix`

O repositório inclui automação multiplataforma completa para compilar o servidor LSP e empacotar a extensão:

### 1. Gerar o Pacote `.vsix`:
```powershell
# No Windows (PowerShell):
powershell.exe -ExecutionPolicy Bypass -File scripts/build-vsix.ps1

# No Linux / macOS (Bash):
./scripts/build-vsix.sh

# Ou via npm:
npm run vsix:build
```

O arquivo gerado é salvo na pasta `dist/` como `dist/thz-lang-0.4.0.vsix`.

### 2. Gerar e Instalar Automaticamente:
```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/build-vsix.ps1 -Instalar
```

### 3. Instalação Manual no VS Code ou Antigravity IDE:
- **No Terminal:**
  ```bash
  code --install-extension dist/thz-lang-0.4.0.vsix
  ```
- **Na Interface Gráfica:**
  1. Abra o painel de **Extensions** (`Ctrl+Shift+X`).
  2. Clique no menu de três pontos (`...`) no canto superior do painel.
  3. Selecione **"Install from VSIX..."** e aponte para `dist/thz-lang-0.4.0.vsix`.

---

## 🛠️ Estrutura da Extensão

```
Extensions/thz-lsp-vscode/
├── syntaxes/
│   └── thz.tmLanguage.json       # Gramática TextMate (Sintaxe canônica e dual moderna)
├── server/
│   └── thz-lsp-0.4.0.jar         # Servidor LSP Java 25 embutido
├── src/
│   └── extension.ts              # Cliente LSP (LanguageClient) e ativação DAP
├── dist/
│   └── extension.js              # Bundle compilado via esbuild
├── language-configuration.json   # Pares de fechamento, recuos e comentários
└── package.json                  # Manifesto e declaração de comandos da extensão
```
