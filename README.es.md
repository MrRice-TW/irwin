# Irwin

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt.md)

**Un espacio de trabajo de escritorio para MongoDB en Windows, Ubuntu y macOS.** Irwin es un proyecto de código abierto con licencia MIT. El soporte de cada plataforma seguirá en fase preliminar hasta completar las pruebas de instalación nativa de la [matriz de compatibilidad](docs/COMPATIBILITY.md).

El [README en inglés](README.md) es la referencia para las traducciones. La interfaz de la aplicación está disponible actualmente en inglés y chino tradicional. Las demás guías están escritas en inglés o chino tradicional.

![Espacio de trabajo de Irwin](docs/images/irwin-workspace.png)

## Estado de las plataformas

| Plataforma                      | Validación actual                                                                                                                                                                                                                             | Estado                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Windows 11 x64                  | Una compilación candidata local sin firma supera las pruebas básicas de escritorio tras el empaquetado. Quedan pendientes la instalación en un entorno limpio, los avisos al descargar por primera vez, la actualización y la desinstalación. | Versión preliminar                        |
| Ubuntu 24.04 x64                | El empaquetado Debian está configurado, pero no se han validado la instalación y el inicio en Ubuntu Desktop nativo.                                                                                                                          | Pendiente de validación por el mantenedor |
| Ubuntu 22.04 x64                | Es un objetivo de compilación de Linux, pero no se ha validado en un escritorio nativo.                                                                                                                                                       | Sin soporte oficial todavía               |
| macOS 14+ Intel / Apple Silicon | El mantenedor informa de una instalación desde DMG y un inicio correctos en un M3 MacBook Air. Quedan por confirmar la versión exacta de macOS, la identidad del DMG, los demás flujos de trabajo y la validación en Intel.                   | Validación nativa parcial                 |

Los instaladores públicos se podrán descargar desde GitHub Releases cuando se publique una versión. No es necesario instalar Irwin mediante una tienda de aplicaciones. Los instaladores preliminares no tendrán firma de editor de pago ni notarización de Apple. La [guía de instalación](docs/INSTALLATION.md) explica cómo verificar las sumas de comprobación y los avisos previstos en el primer inicio. Las rutas generadas por los comandos de empaquetado local son resultados de compilación, no enlaces de descarga.

Para la versión 0.1.0, los nombres configurados son `Irwin-0.1.0-win-x64.exe`, `Irwin-0.1.0-linux-x64.deb`, `Irwin-0.1.0-mac-x64.dmg` e `Irwin-0.1.0-mac-arm64.dmg`. Estos nombres describen resultados de compilación; todavía no son descargas publicadas.

## Funciones

- Gestiona conexiones MongoDB y explora colecciones en las vistas Table, Tree y JSON.
- Consulta y edita documentos conservando los tipos BSON; utiliza una sesión de mongosh independiente por pestaña.
- Conecta tu propio LLM, en la nube o local, para generar borradores de consultas e interpretar MongoDB Explain. Debes activar la función por conexión y puedes revisar el contexto que se enviará. Los borradores de IA nunca se ejecutan automáticamente: tú los revisas, aplicas y ejecutas.
- Importa y exporta JSON, JSONL, CSV y BSON con progreso, cancelación y protecciones explícitas para las operaciones destructivas.
- Guarda perfiles de conexión y preferencias en SQLite local. Los secretos guardados utilizan el sistema de cifrado del sistema operativo; si el almacenamiento seguro no está disponible, solo se conservan durante la sesión actual.

Consulta los flujos de trabajo y las limitaciones en la [guía de usuario](docs/USER_GUIDE.md).

## Instalar Irwin

La [guía de instalación](docs/INSTALLATION.md) incluye instrucciones para Windows, Ubuntu y macOS. Todavía no hay instaladores públicos. El estado de las plataformas y las pruebas nativas pendientes están en la [matriz de compatibilidad](docs/COMPATIBILITY.md).

## Compilar desde el código fuente

Necesitas Node.js 24, pnpm 11.1.0 y un entorno de desarrollo nativo de Windows, Linux o macOS. Compila los instaladores en su sistema operativo de destino. Los objetivos configurados son Windows x64, Ubuntu/Debian x64 y macOS 14+ x64/arm64.

```sh
git clone https://github.com/piayru/irwin.git
cd irwin
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm tools:fetch
pnpm dev
```

`pnpm tools:fetch` descarga MongoDB Database Tools para la plataforma actual y verifica el archivo comprimido con el valor SHA-256 de `vendor/tools-manifest.json`.

El empaquetado de macOS genera DMG para Intel y Apple Silicon. Prepara ambos conjuntos de herramientas con `pnpm tools:fetch mac-x64` y `pnpm tools:fetch mac-arm64`. La comprobación previa al empaquetado verifica ambas arquitecturas.

Irwin se distribuye como aplicación de escritorio, no como paquete npm. La configuración desactiva la publicación en npm para evitar publicaciones accidentales. El código fuente se rige por el archivo `LICENSE` de la raíz.

## Comprobaciones y empaquetado

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm package --publish never
pnpm release:verify
```

`pnpm test` inicia procesos de prueba desechables de MongoDB 8.0.18 y escribe en bases de datos dedicadas a las pruebas. Nunca apuntes las URI de prueba a producción. Las pruebas de integración necesitan acceso a la red para obtener el binario de MongoDB. La validación del escritorio y de los instaladores sigue requiriendo las pruebas manuales nativas de la [lista de comprobación de la versión](docs/RELEASE_CHECKLIST.md). Las comprobaciones de CI no las sustituyen.

## Documentación del proyecto

- [Índice de documentación](docs/README.md)
- [Instalar Irwin](docs/INSTALLATION.md)
- [Compatibilidad y estado de validación](docs/COMPATIBILITY.md)
- [Arquitectura y límites de seguridad](docs/ARCHITECTURE.md)
- [Lista de comprobación de versiones y plataformas](docs/RELEASE_CHECKLIST.md)
- [Guía de pruebas](docs/TESTING.md)
- [Almacenamiento local de datos y credenciales](docs/USER_GUIDE.md#連線)
- [Cómo contribuir](CONTRIBUTING.md)
- [Notificación privada de vulnerabilidades](SECURITY.md)
- [Avisos de terceros](THIRD_PARTY_NOTICES.md)
- [Registro de cambios](CHANGELOG.md)

Irwin es un proyecto independiente y no es un producto oficial de MongoDB. MongoDB, mongosh y MongoDB Database Tools mantienen sus respectivos nombres y licencias.
