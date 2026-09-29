# Irwin

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt.md)

**Um espaço de trabalho de desktop para MongoDB no Windows, Ubuntu e macOS.** Irwin é um projeto de código aberto sob a licença MIT. O suporte de cada plataforma permanece em fase de prévia até que os testes de instalação nativa da [matriz de compatibilidade](docs/COMPATIBILITY.md) sejam concluídos.

O [README em inglês](README.md) é a referência para as traduções. A interface da aplicação está disponível atualmente em inglês e chinês tradicional. Os outros guias estão escritos em inglês ou chinês tradicional.

![Espaço de trabalho do Irwin](docs/images/irwin-workspace.png)

## Estado das plataformas

| Plataforma                      | Validação atual                                                                                                                                                                                                                  | Estado                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Windows 11 x64                  | Uma compilação candidata local sem assinatura passou nos testes básicos de desktop após o empacotamento. A instalação num ambiente limpo, os avisos no primeiro download, a atualização e a desinstalação ainda estão pendentes. | Prévia                               |
| Ubuntu 24.04 x64                | O empacotamento Debian está configurado, mas a instalação e a execução num Ubuntu Desktop nativo ainda não foram validadas.                                                                                                      | Aguardando validação pelo mantenedor |
| Ubuntu 22.04 x64                | É um alvo da compilação para Linux, mas ainda não foi validado num desktop nativo.                                                                                                                                               | Ainda sem suporte oficial            |
| macOS 14+ Intel / Apple Silicon | O mantenedor relatou instalação por DMG e execução num M3 MacBook Air. A versão exata do macOS, a identificação do DMG, os outros fluxos de trabalho e a validação em Intel ainda estão pendentes.                               | Validação nativa parcial             |

Os instaladores públicos estarão disponíveis no GitHub Releases quando uma versão for publicada. Não é necessário instalar o Irwin através de uma loja de aplicações. Os instaladores de prévia não terão assinatura paga do editor nem notarização da Apple. O [guia de instalação](docs/INSTALLATION.md) explica a verificação das somas de verificação e os avisos esperados na primeira execução. Os caminhos gerados pelos comandos locais de empacotamento são resultados de compilação, não links de download.

Para a versão 0.1.0, os nomes configurados dos instaladores são `Irwin-0.1.0-win-x64.exe`, `Irwin-0.1.0-linux-x64.deb`, `Irwin-0.1.0-mac-x64.dmg` e `Irwin-0.1.0-mac-arm64.dmg`. Esses nomes descrevem resultados de compilação; ainda não são downloads publicados.

## Funcionalidades

- Gerir conexões MongoDB e explorar coleções nas vistas Table, Tree e JSON.
- Consultar e editar documentos preservando os tipos BSON, com uma sessão mongosh independente por separador.
- Ligar um LLM próprio, na nuvem ou local, para criar rascunhos de consultas e interpretar o MongoDB Explain. A função precisa de ser ativada em cada conexão e permite rever o contexto a enviar. Os rascunhos da IA nunca são executados automaticamente: o utilizador revê, aplica e executa cada um.
- Importar e exportar JSON, JSONL, CSV e BSON com progresso, cancelamento e proteções explícitas para operações destrutivas.
- Guardar perfis de conexão e preferências numa base SQLite local. Os segredos guardados usam o mecanismo de encriptação do sistema operativo; se o armazenamento seguro não estiver disponível, são mantidos apenas durante a sessão atual.

Consulta o [guia do utilizador](docs/USER_GUIDE.md) para conhecer os fluxos de trabalho e as limitações.

## Instalar o Irwin

O [guia de instalação](docs/INSTALLATION.md) contém instruções para Windows, Ubuntu e macOS. Ainda não existem instaladores públicos. O estado das plataformas e os testes nativos pendentes estão na [matriz de compatibilidade](docs/COMPATIBILITY.md).

## Compilar a partir do código-fonte

São necessários Node.js 24, pnpm 11.1.0 e um ambiente de desenvolvimento nativo em Windows, Linux ou macOS. Compila os instaladores no sistema operativo a que se destinam. Os alvos configurados são Windows x64, Ubuntu/Debian x64 e macOS 14+ x64/arm64.

```sh
git clone https://github.com/piayru/irwin.git
cd irwin
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm tools:fetch
pnpm dev
```

`pnpm tools:fetch` descarrega o MongoDB Database Tools para a plataforma atual e verifica o arquivo comprimido com o valor SHA-256 em `vendor/tools-manifest.json`.

O empacotamento para macOS gera DMG para Intel e Apple Silicon. Prepara os dois conjuntos de ferramentas com `pnpm tools:fetch mac-x64` e `pnpm tools:fetch mac-arm64`. A verificação anterior ao empacotamento confirma ambas as arquiteturas.

O Irwin é distribuído como aplicação de desktop, não como pacote npm. A configuração desativa a publicação no npm para evitar publicações acidentais. O código-fonte segue a licença do arquivo `LICENSE` na raiz.

## Verificações e empacotamento

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm package --publish never
pnpm release:verify
```

`pnpm test` inicia processos de teste descartáveis do MongoDB 8.0.18 e escreve em bases de dados dedicadas aos testes. Nunca direciona os URI de teste para produção. Os testes de integração precisam de acesso à rede para obter o binário de teste do MongoDB. A validação do desktop e dos instaladores continua a exigir os testes manuais nativos da [lista de verificação de lançamento](docs/RELEASE_CHECKLIST.md). As verificações de CI não substituem esses testes.

## Documentação do projeto

- [Índice da documentação](docs/README.md)
- [Instalar o Irwin](docs/INSTALLATION.md)
- [Compatibilidade e estado da validação](docs/COMPATIBILITY.md)
- [Arquitetura e limites de segurança](docs/ARCHITECTURE.md)
- [Lista de verificação de lançamentos e plataformas](docs/RELEASE_CHECKLIST.md)
- [Guia de testes](docs/TESTING.md)
- [Armazenamento local de dados e credenciais](docs/USER_GUIDE.md#連線)
- [Como contribuir](CONTRIBUTING.md)
- [Relato privado de vulnerabilidades](SECURITY.md)
- [Avisos de terceiros](THIRD_PARTY_NOTICES.md)
- [Histórico de alterações](CHANGELOG.md)

O Irwin é um projeto independente e não é um produto oficial do MongoDB. MongoDB, mongosh e MongoDB Database Tools mantêm os respetivos nomes e licenças.
