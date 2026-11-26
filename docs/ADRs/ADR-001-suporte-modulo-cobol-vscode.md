# ADR-001: Compatibilidade e Suporte ao Módulo COBOL na Extensão THZ-LANG

- **Status:** Aceito
- **Data:** 2026-10-11
- **Decisores:** Time de Arquitetura THZ-LANG
- **Contexto:** Ecossistema THZ-LANG (v0.5.0) e Modernização de Legados Mainframe

---

## 1. Contexto e Problema

Com a introdução do módulo `thz-lang-cobol`, das diretrizes em `docs/COBOL_MODERNIZACAO.md` e do `ADR-008` (Suporte COBOL, Transpilação e AOT LLVM IR), a linguagem THZ passou a suportar três variações estratégicas de modernização:
1. **Variação 1 — COBOL Embutido (`BLOCO_COBOL ... FIM_BLOCO_COBOL`)**: sub-rotinas legadas dentro de arquivos `.thz`.
2. **Variação 2 — Copybooks Mainframe (`.cpy`)**: ingestão de schemas de dados mainframe (inclusive `COMP-3` BCD e condições `88`) convertidos para `ESTRUTURA` THZ nativas.
3. **Variação 3 — THZ-COBOL Standalone (`.cbl`, `.cob`)**: execução e compilação direta de arquivos COBOL puros sob o runtime do THZ e LLVM IR.

A extensão oficial para VS Code / Antigravity IDE (`thz-vscode`) precisava se tornar compatível com essa fundação para proporcionar experiência de desenvolvimento contínua, com realce de sintaxe, CodeLens, Live Preview de Arquitetura Viva, Cockpit Outline e execução no terminal integrado.

---

## 2. Decisão Arquitetural

1. **Gramática TextMate Híbrida e Extensível:**
   - Adicionada regra `#cobol-embedded` na sintaxe principal (`syntaxes/thz.tmLanguage.json`) para capturar blocos `BLOCO_COBOL ... FIM_BLOCO_COBOL`.
   - Inclusão delegada de `source.cobol` com fallback transparente para `#cobol-internal-grammar` embutido na própria extensão, garantindo realce de alta fidelidade sem exigir extensões de terceiros.
   - Criação de gramática autônoma `syntaxes/cobol.tmLanguage.json` para arquivos `.cbl`, `.cob` e `.cpy`.
   - Adição da biblioteca/módulo de interop `COBOL` na stdlib de realce léxico.

2. **Language Configuration & Indentação:**
   - Atualizados padrões de indentação em `language-configuration.json` para que `bloco_cobol` aumente o recuo e `fim_bloco_cobol` diminua o recuo automaticamente.

3. **Snippets de Produtividade:**
   - Adicionados templates rápidos em `snippets/thz.json`: `thz-cobol-bloco`, `thz-cobol-copybook`, `thz-cobol-call` e `thz-cobol-standalone`.

4. **CodeLens Contextual:**
   - Detecção em tempo real de blocos `BLOCO_COBOL` (exibindo `PROGRAM-ID` e links rápidos de execução e auditoria), `IMPORTAR_COPYBOOK` e arquivos COBOL standalone.

5. **Live Preview de Arquitetura Viva (Mermaid):**
   - Extração estruturada de nós `BLOCO_COBOL` e `COPYBOOK`.
   - Renderização no grafo geral dentro do subgraph dedicado `🏛️ Interoperabilidade COBOL (C-ABI & LLVM AOT)`.
   - Detecção automática de chamadas `COBOL.<ROTINA>(...)` a partir de regras de negócio e procedimentos, desenhando arestas tracejadas C-ABI até o nó da rotina correspondente.
   - Exibição de parâmetros de *Linkage Section* e detalhes de memória compartilhada zero-copy no Drawer interativo.

6. **Cockpit Outline, Galeria e Ambiente:**
   - Adicionada seção `🏛️ Interoperabilidade COBOL & Mainframe` no Outline interativo.
   - Incorporados exemplos na Galeria (`demo_cobol_interop.thz`, `FOLHA_PAGAMENTO_STANDALONE.cbl`, `CLIENTE_BANCO.cpy`).
   - Adicionado status do runtime no painel de ambiente.

---

## 3. Consequências e Benefícios

- **Experiência Unificada:** Desenvolvedores podem abrir e editar arquivos `.thz` híbridos ou `.cbl` puros com suporte de primeira classe.
- **Rastreabilidade e Governança:** Rotinas legadas COBOL são integradas aos diagramas de arquitetura viva e inspeção de contratos.
- **Zero Lock-in:** O pipeline compila tanto para o dev-host (Panama FFM) quanto para LLVM IR AOT (Zero JVM).
