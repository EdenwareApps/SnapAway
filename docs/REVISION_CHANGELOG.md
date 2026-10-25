# Changelog - Revisão de Implementação Microsoft Store
## 🚀 1.2.4 (25 de Outubro de 2026)

Bump `1.2.3 → 1.2.4` para corrigir o **limiar inalcançável** da faixa de upsell (3 dias distintos com uma base de ~2,9 dias ativos/mês), reduzir pela metade o espaço do log persistente e **diagnosticar** por que "Eventos personalizados" aparece vazio no Partner Center.

### 1. Faixa de upsell a partir do **segundo uso**

- Elegibilidade passou de **3 dias diferentes** para **2 usos reais** (`MIN_USAGE_COUNT = 2` em `src/main/pro-upsell.js`). Um "uso" continua sendo um ciclo completo de ocultar **+** restaurar; abrir o app não conta e ocultar várias janelas no mesmo gesto conta como um único uso.
- Dois usos no **mesmo dia** agora bastam — o relatório de Uso mostrou média de 2,9 dias ativos/mês, então exigir dias distintos deixava a faixa quase inatingível.
- `proUpsellUsageCount` passa a ser a fonte da elegibilidade; `proUpsellUsageDays` (máx. 60, fuso local) fica só como diagnóstico.
- **Migração transparente**: usuários de 1.2.x têm a contagem semeada pelo tamanho da lista de dias já existente — quem tinha 3 dias entra elegível de imediato, sem perder histórico.
- Eventos `retention.pro_upsell_eligible` (disparado uma única vez, no momento em que a contagem atinge 2), `retention.pro_upsell_clicked` e `retention.pro_upsell_dismissed` passaram a carregar `usageCount`.
- A dispensa por ✕ continua valendo **apenas até reabrir o app**.

### 2. Log persistente limitado a 512 KB

- `DEFAULT_MAX_BYTES` em `src/main/telemetry-log.js`: `1 MB → 512 KB`. Com uma única geração anterior, o par `iap-telemetry.log` + `iap-telemetry.1.log` fica em **~1 MB** no disco (antes ~2 MB), mantendo semanas de histórico recente (~2,9 KB/dia).
- `npm run test:telemetry-log` atualizado (18 checks).

### 3. Diagnóstico do `logCustomEvent` (Partner Center)

- O retorno do logger nativo da Store era descartado com `.catch(() => {})` — se o SDK falhasse no pacote, nada era registrado e "Eventos personalizados" simplesmente ficava sem dados.
- `setPartnerCenterCustomEventLogger` agora resolve rejeição, erro síncrono e resultado do nativo, e grava um veredito via novo `telemetry.logLocalEvent()` (só arquivo: não vai ao Sentry nem ao Partner Center, evitando recursão) no evento `store.custom_event.diagnostic` com `{ sampleEvent, logged, available, error, hresult, attempts }`.
- A gravação é "primeiro resultado de cada execução + toda mudança de assinatura": no máximo ~1 linha (~150 B) por sessão, sem inundar o log quando o SDK está quebrado — e o suficiente para separar **"SDK indisponível no pacote"** de **"agregação atrasada"**.

### 4. Fallback de GPU agora remove o processo GPU (Sentry `ELECTRON-K`)

- Investigação dos crashes em aberto mostrou que o fallback de 1.2.x era **insuficiente**: `app.disableHardwareAcceleration()` + `disable-gpu-compositing` ainda deixam o Chromium subir um processo GPU (SwiftShader). Em máquinas com driver quebrado esse processo continua caindo e o próprio Chromium **aborta o browser inteiro** ao atingir o limite interno de 3 crashes em 3 minutos (`IntentionallyCrashBrowserForUnusableGpuProcess` — `ELECTRON-K`, 47 eventos/14d, simbolizado).
- `applyGpuFallback()` agora também aplica `disable-gpu` (e marca `softwareRendering` nas flags), eliminando o processo GPU em vez de apenas trocar o backend.
- A contagem passou a ter **duas fontes**: além do deprecado `gpu-process-crashed`, o `child-process-gone` com `type: 'GPU'` e `reason: 'crashed'` também alimenta `gpuPolicy.recordGpuCrash()`. `recordGpuCrash()` deduplica eventos do **mesmo crash** numa janela de 10 s (em memória), então o par de eventos não dobra a contagem, e `killed`/`reason: 'killed'` continua sem contar.
- Handlers de GPU extraídos para `recordGpuCrashForFallback()` em `src/main/index.js`, com guarda de `app.isQuiting` para não contar crash de shutdown.

### 5. Símbolos nativos no pipeline de release

- `symbols:upload` era um script avulso: 1.2.1 e 1.2.2 foram publicadas sem eventos no Sentry e 1.2.3 não tinha release nenhuma, então os crashes dessas versões chegavam com títulos genéricos (`RaiseException`, `BaseThreadInitThunk`). Agora `dist:appx`, `dist:exe` e `dist:win` terminam com `npm run symbols:upload`.
- `startup_addon.pdb` entrou na lista de PDBs enviados (o addon vai no pacote, mas o PDB não era enviado) — total ~29,5 MB, dentro da cota de Debug Files. Upload de 1.2.4 já executado (`iap_addon.pdb` e `startup_addon.pdb` eram os dois ausentes).

## 🚀 1.2.3 (24 de Outubro de 2026)

Bump `1.2.2 → 1.2.3` para tornar o log de telemetria **auto-limitado** e instrumentar a faixa de upsell do Pro no funil da Store.

### 1. Log persistente de telemetria com rotação

- `iap-telemetry.log` era apenas `appendFileSync`: sem cap, sem rotação, sem poda — crescia indefinidamente (~3 KB por sessão em uso normal, até MBs por ano).
- Nova rotação em `src/main/telemetry-log.js`: ao atingir **1 MB**, o arquivo é renomeado para `iap-telemetry.1.log` (uma única geração, sobrescrita a cada rotação) — no máximo ~2 MB no disco, com o histórico recente preservado.
- Falha de rotação (arquivo em uso, permissão) nunca impede a gravação do evento; o erro só é registrado no console.
- Novos testes em `scripts/test-telemetry-log.js` (`npm run test:telemetry-log`, 17 checks) rodando em Node puro, sem Electron.

### 2. Faixa de upsell no funil do Partner Center

- `retention.pro_modal_viewed` agora carrega `details.source` (`pro_upsell` quando a origem é a faixa; `generic` nos demais casos).
- Novo evento `retention.pro_upsell_modal_opened`, disparado quando a faixa abre o modal Pro. Como o Partner Center recebe **somente o nome** do evento (os `details` são descartados), só um nome dedicado aparece como degrau próprio do funil — `retention.pro_upsell_clicked` continua medindo o clique no CTA.

## 🚀 1.2.2 (24 de Outubro de 2026)

Bump `1.2.1 → 1.2.2` para entregar o **fim das janelas fantasma** ao restaurar apps (caso reportado com o Spotify) e a **faixa de upsell do Pro** exibida após uso real.

### 1. Restauração de janelas: não recriar janelas invisíveis

- `PROCESS_HELPER_CLASSES` e `isRestorableWindow` passam a descartar janelas auxiliares de runtime (ex.: `Default IME`, `MSCTFIME UI`, `GDI+ Window`, `Chrome_*`/`Intermediate D3D Window`), janelas sem título e janelas de **área zero** (`width/height <= 0`) — eram elas que apareciam como uma segunda janela vazia e "Não está respondendo" depois de desocultar o Spotify.
- O `hide` também ignora janelas sem tamanho, então nada é salvo no `hiddenWindows` que não possa ser restaurado de forma útil.
- O restore passou a ser **gated por área e por posse**: só reexibe o que o próprio SnapAway ocultou (registro persistido em `config.hiddenWindows`), inclusive entre sessões do app — se o app foi reiniciado, a janela oculta continua sendo reconhecida pelo handle/classe/título gravados.
- `restoreWindows` ganhou guarda contra "ghost restore": se o handle já não existe ou virou outra janela, ele é apenas removido da lista.

### 2. Faixa de upsell do Pro ("Oculte ainda mais rápido com o Pro")

- Nova faixa abaixo de *What will be protected*, visível **somente** para quem ainda não é Pro e já fez uso real (ocultar **e** desocultar) em **3 dias diferentes** — abrir o app não conta.
- Tracking em `proUpsellUsageDays` (máx. 60 dias, fuso local) e elegibilidade decidida no main (`src/main/pro-upsell.js`).
- O **✕ dispensa apenas até reabrir o app** (estado em memória, nada é gravado no config); a faixa volta no próximo lançamento caso o usuário siga elegível e não tenha virado Pro. A antiga flag `proUpsellDismissedForever` foi removida dos defaults e é ignorada/zerada na migração, para que ninguém perca a faixa para sempre.
- Textos pt/en (`PRO_UPSELL_*`) e testes em `scripts/test-pro-upsell.js` (`npm run test:pro-upsell`).

## 🚀 1.2.1 (23 de Outubro de 2026)

Bump `1.2.0 → 1.2.1` para consertar o **início automático com o Windows** ("iniciar com o Windows"), que não funcionava em **nenhuma** das duas instalações — Store/MSIX e instalador `.exe` — e fazia a interface mostrar o estado oposto ao real.

> Contexto: a revisão de autostart apontou 15 achados em `J:\PROJECTS\SonicAura\SNAPCOVER-AUTOSTART-REVIEW.md`. O diagnóstico central é que existem **dois caminhos de código** (StartupTask/WinRT para a Store e login item do registro para o `.exe`) e os dois estavam quebrados por motivos diferentes: o pacote gerado **não declarava** `<desktop:StartupTask>`, e a leitura do login item usava argumentos diferentes dos da escrita. Na 1.2.0 a opção marcava/desmarcava e o Windows ignorava.
>
> **Revisão do próprio 1.2.1:** os itens 1–7 fecharam os 15 achados da revisão, mas o teste em pacote instalado mostrou que o caminho MSIX continuava sem efeito — o checkbox aparecia desativado e não aceitava marcação. A causa não estava no manifesto (já correto), e sim em **onde** a API era chamada: a identidade de pacote não existe em processos filhos. O item 8 substitui o PowerShell por um addon nativo em C++/WinRT e é o que faz a opção realmente funcionar na Store. Detalhamento da medição na seção "Causa raiz" mais abaixo.

### ✅ Correções

1. **A tarefa de inicialização passou a existir no pacote** — `build/appx/extensions.xml` (novo) + `package.json`
   - O `.appx` gerado em `dist` não continha `<desktop:StartupTask>`, então o caminho WinRT (`StartupTask.GetAsync`) nunca funcionava na build da Store: o app tentava ativar uma tarefa que o manifesto não declarava.
   - Novo `build/appx/extensions.xml` com `<desktop:StartupTask TaskId="SnapAway" Enabled="false" DisplayName="SnapAway" />` (sem elemento raiz, sem `Arguments` — a StartupTask não aceita argumentos), ligado ao build por `build.appx.customExtensionsPath`.
   - `.gitignore` ganhou bloco de negação: `build/` é ignorado por regra genérica de template, então o único arquivo de `build/` sob versionamento é esse `extensions.xml`.
   - Validado com `MakeAppx`: o manifesto **empacotado** contém a `StartupTask` com `Enabled="false"`.

2. **O caminho de erro deixou de reportar sucesso** — `src/main/index.js`
   - `runWinRTStartupTask` tratava `"NotFound"` como sucesso: "ativar" respondia `success: true`, gravava `config.startup = false` e a UI mostrava o autostart **desligado**.
   - Agora a saída é validada contra a lista fechada de estados (`Enabled`, `DisabledByUser`, `DisabledByPolicy`, `DisabledBySystem`, `Disabled`), com `$ErrorActionPreference = "Stop"`, `Wait(5000)` com checagem de timeout e **leitura de confirmação** (`GetAsync` de novo) depois de enable/disable; `NotFound`/timeout viram erro explícito.

3. **A leitura do login item (`.exe`) passou a usar o mesmo estado da escrita** — `src/main/index.js`
   - `autostartRegistration()` virou a fonte única de `path`/`args`/`name` para **escrita e leitura**, com o caminho entre aspas.
   - Descoberto por experimento com o Electron 28 real: `SetLoginItemSettings` grava `path + " " + args` **sem** adicionar aspas, e `openAtLogin` compara a string do registro por **igualdade exata** — daí `isEnabled` ser sempre `false`. Com o caminho citado nos dois lados, escrita e leitura coincidem byte a byte (inclusive com espaços e acentos no caminho).
   - `openAtLogin` também falha contra o próprio valor quando o caminho tem caractere não-ASCII (mangling de `base::StringPrintf("%ls …")` em `FormatCommandLineString`) e `launchItems[].args` **descarta switches** (`--autostart` nunca aparece ali). A leitura passou a usar `openAtLogin || launchItems.length > 0`, com `enabled` vindo de `executableWillLaunchAtLogin` (que reflete o `StartupApproved` do Windows).

4. **Respeito a quem desativou na lista de inicialização** — `src/main/index.js`
   - `syncStartupPreferenceOnBoot()` deixou de reescrever a preferência e passou a **espelhar** o que o Windows realmente faz: no MSIX pelos estados `Enabled*`/`DisabledBy*`, no `.exe` pelo registro. Desativar o app em `Configurações > Aplicativos > Inicialização` não é mais desfeito no próximo boot.
   - `settle()` lê o registro depois de cada escritor (Electron → helper → elevado) e é ele quem decide a resposta; `blocked` interrompe a escalada de UAC.
   - Fallback de login item removido do ramo MSIX: sem estado reconhecido, `get-startup-state` responde `available: false` em vez de inventar um resultado.

5. **A interface reflete o estado real** — `src/renderer/components/ShortcutSetter.svelte`
   - O checkbox adota o estado devolvido pelo Windows no `onMount` (antes assumia `config.startup`), fica **desabilitado** quando o Windows bloqueou, reverte `e.target.checked` quando a operação falha e mostra um aviso com link direto para `ms-settings:startupapps`.

6. **Helper nativo: escrita no registro e escape de JSON** — `src/helper/SnapAwayHelper.cpp`
   - `GetArgValue()` não fazia *unescape* de JSON: o caminho chegava ao registro com `\\` duplicado. Novo `JsonUnescape()`.
   - Escrita/remoção passaram a usar as APIs Unicode (`RegCreateKeyExW` / `RegSetValueExW` / `RegDeleteValueW`) com `Utf8ToUtf16`, e o nome do valor padrão passou a ser `Edenware.app.Snapcover` (o mesmo que o app usa) — antes os dois lados podiam divergir.

7. **Manifesto e pipeline de empacotamento** — `AppxManifest.xml`, `package.json`, `scripts/`
   - `dpiAware` e `Arguments` removidos do `AppxManifest.xml` da raiz (não existem no schema; o `MakeAppx` rejeita) e o arquivo ganhou cabeçalho dizendo que é cópia de referência — o build usa o template do electron-builder + `extensions.xml`.
   - `scripts/build-appx.js` **apagado**: ele empacotava o template sem substituir as variáveis, gerando um pacote inválido. `npm run appx` / `npm run dist:appx` são o pipeline único; docs (`STORE_SUBMISSION_COMPLETE.md`, `IMPLEMENTATION_REVIEW.md`), `verify-submission.js`, `prepare-submission.js`, `store-summary.js` e `post-submission-guide.js` não citam mais o arquivo morto.
   - `scripts/validate-store-compliance.js` passou a validar `windows.startupTask`, `TaskId`, `Enabled="false"` e a ausência de `Arguments`; `verify-submission.js` (Teste 5) valida `build.appx.customExtensionsPath` e o arquivo.
   - `prepare-submission.js` e `store-summary.js` tinham **BOM antes do shebang**, o que faz o Node recusar tanto `--check` quanto a execução. BOM removido.

8. **A `StartupTask` passou a ser chamada de dentro do processo empacotado** — `src/startup/` (novo addon nativo), `src/main/index.js`
   - Causa raiz medida em máquina real: **a identidade de pacote do MSIX é por processo e não é herdada por processos filhos**. Um `powershell.exe` gerado com `execFile` a partir do app empacotado responde `GetCurrentPackageFullName = 15700` (`APPMODEL_ERROR_NO_PACKAGE`), então toda chamada WinRT feita pelo PowerShell falhava com `0x80070490` e a UI concluía `available: false` — daí o **checkbox desativado e impossível de marcar** na 1.2.1 da Store.
   - Segunda medição: **escritas no registro feitas por um processo empacotado são virtualizadas** (redirecionadas para o hive privado do pacote), então `setLoginItemSettings` como fallback do MSIX é um no-op silencioso — nunca poderia funcionar.
   - Correção: addon N-API em **C++/WinRT** (`src/startup/startup-addon.cpp`, `startup_addon.node`) que chama `Windows.ApplicationModel.StartupTask` **dentro** do processo principal, onde a identidade existe. Exporta `startupTask(action, taskId)` → `Promise<{ok, action, state, error, hresult, code, packageFamilyName}>` e `packageFamilyName()`.
   - `RequestEnableAsync()`/`GetAsync()` **travavam** com `.get()` (deadlock de apartamento). O addon usa apartamento **STA** e faz *polling* de `IAsyncInfo::Status` bombeando `PeekMessage`/`DispatchMessage`, chamando `GetResults()` só em `Completed`.
   - `src/main/index.js`: `loadStartupTaskAddon()` carrega o `.node` via `process.dlopen` (candidatos: `out/main`, `src/startup/build/Release`, `dist`, dentro do `app.asar`), `getStoreInstallContext()` passa a detectar identidade real por `packageFamilyName()`, e `runWinRTStartupTask()` usa o addon primeiro, com o PowerShell rebaixado a último recurso. O fallback PowerShell também ganhou `AsTask` por reflexão (`GetMethods()` + `MakeGenericMethod`).
   - `electron.vite.config.mjs` copia o addon para `out/main/`; `package.json` ganhou `rebuild:startup` / `copy:startup` e ambos entraram em `rebuild:native` / `copy:natives`. Build por `node-gyp` com N-API 8 (sem `electron-rebuild`).
   - **Verificado no app empacotado real** (ativado por AUMID `Edenware.app.Snapcover_7d0j5g8tv3xay!SnapAway`, `--inspect`): `packageFamilyName` presente, `get` → `Disabled`, `enable` → `Enabled`, `disable` → `Disabled`, e o IPC do checkbox responde `available: true` nos três estados (antes: `available: false`).
   - Nota: **não há UAC em nenhum passo** — a `StartupTask` é uma permissão por usuário e a Microsoft não pede elevação para ativá-la. A ausência de UAC é o comportamento correto, não um sintoma.
   - Linhas fantasma em `Task Manager > Startup apps` (ex.: "SnapAway — Desativado" mesmo com o app desinstalado) vinham de valores órfãos em `HKCU\…\Explorer\StartupApproved\Run` (`SnapAway`, `Snapcover`, `app.edenware.snapcover`), sem o valor correspondente em `…\Run`. Não são criados pela versão nova e podem ser apagados.

### 🔧 Diagnóstico

- Detecção de boot por `process.argv.includes('--autostart')`, com comentário explícito de que `wasOpenedAtLogin` é **só macOS** e que a StartupTask não aceita argumentos (a 1.2.0 não detectava boot pela Store).
- Verificação de ponta a ponta em laboratório: funções reais de `src/main/index.js` executadas no Electron 28.3.3 contra o registro do Windows — valor gravado pelo helper → `{registered:true, enabled:true}`; escrita do Electron gera string **idêntica**; `StartupApproved` desligado → `blocked:true`; reativado → `true`; desativado → valor removido, `registered:false`; caminho `"C:\...\SnapAway Ção\SnapAway.exe" --autostart` idêntico pelos dois escritores.

### 🏷️ Versão

- `package.json` / `package-lock.json`: `1.2.0 → 1.2.1` (o `AppxManifest.xml` usa `Version="${version}"` e herda automaticamente).
- `auto-launch` removido das dependências (não era mais usado; a escrita passou a ser feita por `setLoginItemSettings` + helper).

---
## 🚀 1.2.0 (25 de Setembro de 2026)

Bump `1.1.9 → 1.2.0` para eliminar os relatórios de **travamento (hang)** no Health da Microsoft Store (`MOAPPLICATION_HANG_*_HANG_QUIESCE`) e tornar o encerramento e a telemetria mais previsíveis.

> Contexto: os números de "travamento" da Store (18–21%) **não são falhas/crashes**. São hangs de encerramento: o Windows termina à força o app que não responde ao fim de sessão, e isso também gerava os eventos `reason: "killed"` (exit code `0x40010004` = `DBG_TERMINATE_PROCESS`) que apareciam no Sentry como se fossem crashes.

### ✅ Correções

1. **Encerramento de sessão do Windows (HANG_QUIESCE)** — `src/main/index.js`
   - O handler de `close` da janela chamava `event.preventDefault()` quando o app não estava saindo. Se o pedido de fechamento chegasse antes de as flags serem marcadas (desligar/reiniciar/sair da conta), o fechamento era **bloqueado** e o Windows aguardava o orçamento de quiesce antes de matar o processo — exatamente o bucket `HANG_QUIESCE`.
   - Nova flag `sessionEnding`, marcada **antes de qualquer trabalho** no `app.on('session-end')`, junto de `app.isQuiting = true`.
   - O `close` da janela não bloqueia mais durante o fim de sessão.
   - `session-end` agora usa **`app.exit(0)`** (encerramento imediato) em vez de `app.quit()`, evitando todo o teardown de janelas/processos durante o orçamento de quiesce.
   - `before-quit` não atrasa o encerramento no fim de sessão e o flush de telemetria foi reduzido de 3s para **1,5s** (o valor anterior pioraria o hang).

2. **Limpeza de áudio/ícones não bloqueante** — `src/system/system.js` + `src/main/index.js`
   - O `cleanupAudio()` executava um teardown **COM síncrono** (`Release()` + `CoUninitialize()` no addon nativo) **dentro do caminho de encerramento**, antes do `app.quit()`. Com o serviço de áudio lento (Bluetooth/HDMI reconectando), isso pode pendurar a thread principal — candidato a `APPLICATION_HANG_ENDTASK_HungThreadIsIdle`.
   - `cleanupAudio()` agora é **idempotente** (no máximo uma execução por processo), **nunca rejeita**, tem **orçamento de tempo** (`timeoutMs`, timer com `unref`) e registra a **duração** da limpeza.
   - Em `index.js`, a limpeza é **agendada com `setImmediate`** (roda depois de o quit já estar comprometido), **nunca é aguardada** e é **pulada no fim de sessão**. Se o processo sair antes, o sistema operacional libera os recursos.
   - Novo `system.getAudioCleanupStats()` para diagnóstico e escape hatch `SNAPAWAY_SKIP_AUDIO_CLEANUP=1` para pular o teardown nativo.
   - Se a limpeza exceder o orçamento, é emitido `app.audio-cleanup-slow` (com `durationMs`) no log persistente e no Sentry — insumo para o próximo ciclo.

3. **Eventos de processo terminado não são mais reportados como crash** — `src/main/telemetry.js` + `src/main/index.js`
   - `render-process-gone` / `child-process-gone` com motivo `killed`, `clean-exit` ou `launch-failed` continuam no log persistente, mas **não viram issue no Sentry** (o Windows matando o app no shutdown não é falha do aplicativo).
   - Motivo e código de saída passam a ir como **tags** (`processReason` / `processExitCode`), permitindo agrupar e quantificar por motivo no Sentry.
   - **`gpu-process-crashed` entrou no mesmo filtro**: esse evento do Electron informa apenas `killed` (sem `reason`), então escapava da regra e virava issue **sempre** — era o `ELECTRON-Y`. Agora `killed: true` é normalizado para `reason: "killed"` **antes** de gravar no log e de enviar, então término intencional é filtrado igual aos demais eventos de processo.
   - O payload do `gpu-process-crashed` passou a levar **`exitCode` / `serviceName` / `type`**, obtidos do `child-process-gone` do mesmo processo GPU (cache de 5 s, usado só quando o `reason` do cache é coerente com `killed`) — antes ia apenas `{ killed }`, o que impedia separar crash real de término no dashboard.
   - Efeito medido: nas 1.070 ocorrências do quarteto `ELECTRON-X/T/V/Y`, **~92% eram `reason: "killed"`** (63% com `exitCode 1073807364` = `0x40010004` `DBG_TERMINATE_PROCESS`) e só **~8% eram crash real de GPU** (`exitCode` 34 / 2 / `-1073741819` `0xC0000005`).

4. **Telemetria deixava de enviar os últimos eventos** — `src/main/telemetry.js` + `src/main/index.js`
   - O aplicativo nunca chamava `Sentry.flush()`; como o transporte é assíncrono, eventos gerados perto do encerramento eram perdidos.
   - Nova `flushTelemetry(timeoutMs)` no `before-quit`, com `preventDefault()` apenas na primeira passagem e orçamento curto — envia o que está pendente sem travar o encerramento.

5. **Fallback de GPU não conta mais término intencional** — `src/main/index.js`
   - O handler de `gpu-process-crashed` chamava `gpuPolicy.recordGpuCrash()` **sempre**, inclusive quando `killed === true` (processo terminado de propósito no encerramento). Isso significa que dois encerramentos normais bastavam para **desligar a aceleração de hardware** do usuário e persistir o estado em `gpu-fallback.json` por 7 dias, **sem nenhum crash real ter acontecido**.
   - Agora `killed === true` é registrado como `app.gpu-fallback.skipped-killed` no log persistente e **não incrementa** o contador; só crash de verdade conta para o limiar de 2.

6. **Crash nativo no encerramento — `iap_addon.node`** — `src/iap/iap-addon.cpp`
   - O `StoreProduct` do fluxo de compra ficava em um **membro** do worker (`StoreProduct storeProduct_{ nullptr }`) mas era criado dentro de `Execute()`, que roda em uma thread do pool do libuv. O objeto sobrevivia ao `Execute()` e era liberado depois **na thread de JavaScript** — um `Release` cross-apartment sobre um proxy COM (`RPCRT4`) cujo apartamento de origem só morria no fim do processo. É exatamente o `ELECTRON-1A`: `EXCEPTION_ACCESS_VIOLATION_READ / 0xFFFFFFFFFFFFFFFF` dentro de `ComPtr<T>::InternalRelease`, durante o teardown.
   - O `StoreProduct` agora é **local ao `Execute()`**: criado e liberado na mesma thread/apartamento. O `StoreId` que precisa atravessar o fluxo já era cacheado como string (`purchaseStoreId_`).
   - `init_apartment(single_threaded)` era chamado por thread em `EnsureWinRTApartment()` e **`uninit_apartment()` nunca era chamado**: cada thread do pool deixava uma STA viva até o fim do processo. Novo `WinRTApartmentScope` (RAII, primeiro local do `Execute()` — destruído portanto **depois** de todos os objetos WinRT do bloco) higieniza o apartamento a cada item de trabalho. `ReleaseWinRTApartment()` só desfaz o apartamento que **nós** iniciamos naquela thread, para não tocar no da thread principal do Electron (usado por `logCustomEvent`).
   - Validado contra a Store real: 3 rodadas de `getProducts` / `getLicenseInfo` / `checkOwnership` com dados corretos, `init_apartment` sendo reinicializado a cada item (prova de que o `uninit` roda) e saída limpa do processo.

7. **Exceção não capturada nas threads STA do `iap_addon.node` derrubava o processo** — `src/iap/iap-addon.cpp`
   - `RunPurchaseOnSTA()` e `RunRateAndReviewOnSTA()` executam o corpo em uma `std::thread` própria. O invoker da `std::thread` é `noexcept`: **qualquer** exceção que escape da lambda chama `std::terminate` e mata o processo. O `try/catch` do `Napi::AsyncWorker::OnExecute` (node-addon-api) protege apenas o `Execute()` que roda no pool do libuv — esta thread criada à mão ficava **sem rede de proteção**.
   - É exatamente a assinatura do `ELECTRON-19` (`RaiseException` / "Unhandled C++ Exception", `KERNELBASE!RaiseException` no topo e frames de `iap_addon.node`) e dos demais `RaiseException` do addon (`ELECTRON-W`, `-10`, `-13`, `-16`, `-18`): **23 eventos** somados entre 7 issues.
   - Novo helper `DescribeCurrentException()` (rethrow + captura de `winrt::hresult_error` / `std::exception` / desconhecidas) e um `catch (...)` envolvendo `DoRunPurchaseOnSTA()` / `DoRunRateAndReviewOnSTA()` dentro da lambda: a falha passa a virar `status: "Error"` com a mensagem no erro devolvido ao JS, em vez de crash do processo.
   - Rebuild nativo validado: `iap_addon.node` recompila sem avisos, os 7 exports carregam no Electron e `logCustomEvent` continua no caminho de fallback gracioso (`Class not registered`) fora da Microsoft Store.

### 🎨 Interface

1. **"Sobre" virou "Ajuda"** — `src/renderer/App.svelte` + `src/language/texts.json`
   - Na seção **Opções**, o item "Sobre" agora aparece como **Ajuda**, com ícone de interrogação (`fa-question-circle`), mantendo o mesmo destino.
   - Nova chave `HELP` adicionada nos **20 idiomas** (pt: "Ajuda", en: "Help", es: "Ayuda", de: "Hilfe", ja: "ヘルプ", zh: "帮助" etc.).

### 🔧 Diagnóstico

1. **Símbolos dos addons nativos passam a ir para o Sentry** — `scripts/upload-native-symbols.js` + `npm run symbols:upload`
   - Sem os PDBs dos nossos addons, o Sentry simboliza as DLLs do Windows mas deixa os frames dos módulos **nossos** como `null` (status `missing`) — escondendo justamente o ponto que interessa. Foi o caso do `ELECTRON-1A`: o frame dentro de `iap_addon.node` apareceu sem nome, e o issue ficou com o título enganoso `InitOnceExecuteOnce` (que na verdade é um frame do `KERNELBASE.dll`).
   - O script envia **apenas** os PDBs dos 5 addons que vão no pacote (`iap`, `audio`, `icons`, `process`, `windows`): **~22 MB** no total. Os PDBs oficiais do Electron (`electron-v<versão>-win32-x64-pdb.zip`) somam **~1,8 GB por release** e ficaram deliberadamente de fora — consumiriam a cota de Debug Files do projeto sem resolver os frames dos nossos módulos.
   - Os `debug_id` foram conferidos contra o pacote 1.1.9 e casam 1:1 (mesmo GUID+age), então os símbolos enviados valem para os crashes dessa versão.
   - Requer `SENTRY_AUTH_TOKEN` (nunca commitado). Sem o token, o script avisa e sai com `0`; com `--strict` falha — para usar em pipeline de release.
   - O token também pode vir do **`.sentryclirc`** (raiz do repo ou `HOME`), com `[auth] token` e `[defaults] org/project`; a variável de ambiente tem precedência. O arquivo é **local e gitignored** (`.gitignore`), e o template versionado é o **`.sentryclirc.example`** — assim dá para rodar `npm run symbols:upload` sem exportar variáveis, sem risco de commitar o token.

2. **Triagem dos issues do Sentry que a 1.2.0 resolve** — consulta à API do Sentry (`edenwareapp/electron`, release `SnapAway@1.1.9`)
   - Dos **24 issues não resolvidos**, **7 têm frames em `iap_addon.node`** (23 eventos): `ELECTRON-W` (8), `-10` (7), `-18` (2), `-16` (2), `-13` (2), `-1A` (1), `-19` (1).
   - Os dois issues **novos** do relatório semanal (25/09–02/10) são justamente `ELECTRON-1A` (`EXCEPTION_ACCESS_VIOLATION_READ` em `ComPtr<T>::InternalRelease`) e `ELECTRON-19` (`Unhandled C++ Exception` / `RaiseException`), ambos com **1 evento**, em build `installContext = store`, `release = SnapAway@1.1.9`.
   - `ELECTRON-1A` já era coberto pelo item 6 (lifetime/apartamento COM) e `ELECTRON-19` pelo item 7 (exceção escapando da `std::thread` STA): os dois já estão corrigidos neste 1.2.0. O item 7, porém, é **posterior** à build 1.2.0 empacotada em 01/10 (`dist/SnapAway_1.2.0_win_x64.appx` usa o `iap_addon.node` de 30/09) — ver o item 3.

3. **Quais issues ainda ocorrem depois da 1.2.0** — consulta à API do Sentry (`edenwareapp/electron`)
   - Uma build 1.2.0 está em produção desde **01/10/2026 13:39 UTC** (`release = SnapAway@1.2.0`, `installContext = store`, usuários na Nigéria e na Indonésia); o `1.1.9` continuou recebendo eventos até **02/10** (rollout ainda em curso).
   - **Na 1.2.0 só ocorreram 2 issues**, ambos internos do Chromium — nenhum no nosso código nem nos addons nativos:
     - `ELECTRON-9` (03/10, 3 eventos) — `Fatal Error: Out of Memory` em `base::DiscardableMemoryAllocator::AllocateLockedDiscardableMemoryWithRetryOrDie` ← `cc::GpuImageDecodeCache::DecodeImageIfNecessary` (decodificação de imagem na GPU).
     - `ELECTRON-C` (01/10, 15 eventos) — `EXCEPTION_ACCESS_VIOLATION_READ` em `CPDF_DeviceCS::v_Load` (PDFium/print) sob pressão de memória.
   - **Nenhum** dos issues que a 1.2.0 ataca voltou a ocorrer nessa build: os 7 do `iap_addon.node` (`ELECTRON-1A`, `-19`, `-W`, `-10`, `-13`, `-16`, `-18`; 23 eventos, último em 30/09) e o quarteto `ELECTRON-X` / `-T` / `-V` / `-Y` mais `ELECTRON-3` e `ELECTRON-8` (últimos eventos em 30/09–02/10, todos em `1.1.9`). O `ELECTRON-11` já havia sido corrigido no commit `28236d7` (1.1.6), com último evento em 05/09.
   - **Não cobertos pela 1.2.0** (10 issues, todos crash interno de Chromium/Electron/V8/Windows): `ELECTRON-9` e `-C` (já confirmados na 1.2.0), `ELECTRON-Q` (watchdog da GPU), `-K` (fallback de GPU inutilizável), `-F` (locale/`AltText` do Blink), `-S` (`GetWmiMonitorIDInfo`), `-17` (V8 *call site*), `-R` (`MessagePumpForUI`), `-Z` (`SkAbort` na captura de desktop) e `-15` (`WorkerThreadCOMDelegate`).
   - Ressalva: a amostra da 1.2.0 ainda é pequena (rollout em andamento, `1.1.9` ainda reportando). A ausência de reincidência é forte, mas ainda não conclusiva.

### 🏷️ Versão

- `package.json` / `package-lock.json`: `1.1.9 → 1.2.0` (o `AppxManifest.xml` usa `Version="${version}"` e herda automaticamente).

---
## 🚀 1.1.9 (9 de Setembro de 2026)

Microbump `1.1.8 → 1.1.9` para usar a tecla configurada na dica de restauração.

### ✅ Correção

1. **Dica pós-hide usa o atalho real de mostrar** — `src/main/index.js`
   - A notificação "Done! / Press Ctrl+F6 to restore" citava o atalho padrão fixo. Como as teclas são customizáveis, agora a dica usa a tecla de mostrar configurada pelo usuário (troca o literal `Ctrl+F6` pelo `config.showKey`; sem mudança quando o atalho é o padrão).

### 🏷️ Versão

- `package.json` / `package-lock.json`: `1.1.8 → 1.1.9` (o `AppxManifest.xml` usa `Version="${version}"` e herda automaticamente).

---
## 🚀 1.1.8 (9 de Setembro de 2026)

Microbump `1.1.7 → 1.1.8` para reduzir relatórios de "hang" no encerramento da sessão do Windows.

### ✅ Correção

1. **Tratamento de fim de sessão (Windows)** — `src/main/index.js`
   - O app (residente na bandeja e com auto-start) não tratava o fim de sessão (desligar, reiniciar ou sair da conta). Nesses casos o Windows dá um orçamento curto de quiesce e pode encerrar o processo à força, gerando relatório de hang (`hang_quiesce`) no Health da Store.
   - Novo handler `app.on('session-end')`: finaliza rapidamente (sem diálogos nem cleanup longo) e encerra o app dentro do orçamento do sistema. Trace de telemetria `app.session-end`.

### 🏷️ Versão

- `package.json` / `package-lock.json`: `1.1.7 → 1.1.8` (o `AppxManifest.xml` usa `Version="${version}"` e herda automaticamente).

---
## 🚀 1.1.7 (9 de Setembro de 2026)

Microbump `1.1.6 → 1.1.7` com a opção de avaliar o SnapAway na Microsoft Store diretamente no aplicativo.

### ✅ Nova funcionalidade — Avaliação (review) na Microsoft Store

1. **Convite para avaliar** — `src/main/review-prompt.js` (novo)
   - Depois de algum tempo de uso, o aplicativo oferece ao usuário a opção de avaliar o SnapAway na Microsoft Store, em um momento que não interrompe o fluxo de trabalho.
   - O usuário pode adiar o convite ou optar por não recebê-lo novamente (preferência respeitada e persistida).

2. **Diálogo nativo com fallback** — `src/iap/iap-addon.cpp`
   - Novo `RequestRateAndReviewWorker` que abre o diálogo oficial de avaliação da Microsoft Store (`StoreContext::RequestRateAndReviewAppAsync`), exposto como `requestRateAndReview`.
   - Fallback para a página do produto na Store quando o diálogo nativo não puder ser exibido.
   - Envoltório em `src/iap/iap-wrapper.js` com stub de fallback.

3. **Interface e localização**
   - `src/renderer/components/ReviewModal.svelte` (novo): modal com as opções "Avaliar agora", "Agora não" e "Não perguntar de novo".
   - `src/renderer/App.svelte` e `src/preload/index.js` para a comunicação entre main e renderer.
   - Textos em `en` e `pt` (`src/language/texts.json`).
   - Preferências do usuário persistidas no config (`defaults.json`, raiz e `src/config`).

### 🏷️ Versão

- `package.json` / `package-lock.json`: `1.1.6 → 1.1.7` (o `AppxManifest.xml` usa `Version="${version}"` e herda automaticamente).

---
## 🚀 1.1.6 (9 de Setembro de 2026)

Microbump `1.1.5 → 1.1.6` com correções de estabilidade/renderer e redução de ruído no Sentry.

### ✅ Correções

1. **Renderer: "Cannot set properties of null (setting 'innerHTML')" (ELECTRON-11)** — `src/renderer/index.html` + `src/renderer/App.svelte`
   - Sintoma: erro em handler de IPC do renderer ao setar `innerHTML` em elemento ausente do DOM.
   - Causa: `updateDisplay()` (`passwordDisplay`/`#password`) e `toggleContainer()` (`icon`/`.cet-icon-options`) sem checagem de nulidade.
   - Fix: guardas `if (!element) return` antes dos `innerHTML` nesses dois pontos.

2. **Sentry: ruído do overlay "launch-failed" ainda virava issue (ELECTRON-8)** — `src/main/telemetry.js`
   - Causa: o ELECTRON-8 vem da integração `child-process` do @sentry/electron (captura automática de `'renderer' process exited with 'launch-failed'`), fora do nosso `captureTelemetryEvent`.
   - Fix: `beforeSend` agora descarta (`return null`) eventos com `process exited with 'launch-failed'` — complementa a supressão já existente.

3. **Fallback automático de GPU por crashes repetidos (ELECTRON-Y/S/8)** — `src/main/gpu-policy.js` + `src/main/index.js`
   - Contexto: em algumas máquinas o processo GPU do Chromium cai repetidamente (janelas transparentes/always-on-top + driver instável), gerando `gpu-process-crashed` (ELECTRON-Y), crash de DxDiag/WMI (ELECTRON-S) e overlay `launch-failed` (ELECTRON-8).
   - Fix: estado persistido em `gpu-fallback.json` no userData (`{disabled, crashCount, disabledAt}`). Após **2** `gpu-process-crashed`, desliga a aceleração de hardware na próxima sessão e reinicia o app uma vez para aplicar na hora. No startup, `applyGpuFallback()` chama `app.disableHardwareAcceleration()` + `disable-gpu-compositing`. Janela de recuperação de **7 dias** re-tenta HW accel (driver pode ter sido atualizado). Sem loop de relaunch.

### 🏷️ Versão

- `package.json` / `package-lock.json`: `1.1.5 → 1.1.6` (o `AppxManifest.xml` usa `Version="${version}"` e herda automaticamente).

---
## 🚀 1.1.4 (31 de Agosto de 2026)

Microbump `1.1.3 → 1.1.4` com correções baseadas na revisão dos issues do Sentry da release `SnapAway@1.1.3`.

### ✅ Correções

1. **Falha ao carregar ícone da janela em instalação MSIX (ELECTRON-12)** — `src/main/index.js`
   - Sintoma: `Error: Failed to load image from path '...\app.asar\snapaway.ico'` em `createWindow` (instalação via Microsoft Store).
   - Causa raiz: `new BrowserWindow({ icon: <path> })` e `window.setIcon(<path>)` recebem o **path cru**; o carregador **nativo** não lê dentro do `app.asar` (o `getDefaultIconPath()` devolve `...app.asar\snapaway.ico` porque `fs.existsSync` passa pelo shim do asar).
   - Fix: novo helper `toNativeIcon(path)` (usa `nativeImage.createFromPath`, que é aware-de-asar) aplicado em `new BrowserWindow({ icon })` e `window.setIcon()` — com degradação graciosa (sem ícone) se falhar.

2. **Telemetria Sentry: ruído de `render-process-gone` + títulos genéricos** — `src/main/telemetry.js`
   - Suprime no Sentry os eventos `window/app.render-process-gone` com `reason === 'launch-failed'` (ruído do overlay, não-bug do app; continuam no log persistente).
   - `beforeSend` força o título dos issues de telemetria para o `eventName` (ex.: `app.render-process-gone`) em vez do culprit genérico `withTelemetryScope`.

### 🏷️ Versão

- `package.json` / `package-lock.json`: `1.1.3 → 1.1.4` (o `AppxManifest.xml` usa `Version="${version}"` e herda automaticamente).

---
## 🚀 1.1.3 (22 de Agosto de 2026)

Microbump `1.1.2 → 1.1.3` com correções de estabilidade baseadas na análise dos issues do Sentry (release `SnapAway@1.1.2`).

### ✅ Correções

1. **"TypeError: Object has been destroyed" (ELECTRON-D/E/H/J/M/N/P)** — `src/main/index.js`
   - Causa raiz: durante o encerramento, a janela principal é destruída mas a referência `window` (=== `global.window`) segue truthy até o evento `'closed'`; qualquer `if (window)` passava e a chamada lançava.
   - Fix: guards `!window.isDestroyed()` adicionados em todos os pontos quentes que tocam a janela sem checagem: `requestAuthCheck`, `notifyStateChanged`/`toggleShowHide` (+ catch do show), handler `click()` do tray (2 blocos), itens OPEN/OPTIONS do menu, handlers `second-instance` (2 × 2 blocos), `showAuthPrompt`, `restoreWindowAfterAuth`, `updateNotificationBadge`, `resizeForAuth`, sends de `updateConfig` e `canAutoFloatOnBlur`.

2. **Overlay renderer "launch-failed" em loop (ELECTRON-8, 197 eventos)** — `src/main/overlay-manager.js`
   - Causa raiz do loop: o backoff antigo ("≥3 crashes em 8s") nunca engatava porque a recriação é gated pelo hover do cursor — crashes espaçados >8s resetavam o contador.
   - Fix: streak de falhas consecutivas (`rendererCrashStreak`) que só zera em `did-finish-load`/`start()`, com backoff escalonado (60s → 5min → 15min → 1h) e log de `reason` + `exitCode`.

3. **Telemetria Sentry: issues sem título útil (ELECTRON-3, 1186 eventos)** — `src/main/telemetry.js`
   - Causa: todos os `captureMessage` dos `SENTRY_ISSUE_EVENTS` tinham o mesmo stack (`withTelemetryScope`) e eram agrupados num único issue.
   - Fix: `scope.setFingerprint([eventName])` em `captureTelemetryEvent` e `captureProductEvent` — cada tipo de evento vira seu próprio issue (ex.: `window.render-process-gone`).

### 🏷️ Versão

- `package.json` / `package-lock.json`: `1.1.2 → 1.1.3` (o `AppxManifest.xml` usa `Version="${version}"` e herda automaticamente).

---
## 🔄 Status de Migração de Build (8 de Março de 2026)

- Pipeline antigo com `rollup.config.js` e saída `renderer/dist/bundle.js`/`bundle.css` foi descontinuado.
- Build oficial agora usa `electron-vite` com saída em `out/main`, `out/preload` e `out/renderer`.
- Runtime do main process atualizado para carregar `ELECTRON_RENDERER_URL` em dev e `out/renderer/index.html` em build.
- Scripts e documentação atualizados para usar `npm run dev:vite` e `npm run build`.

## 📝 Alterações Realizadas (4 de Março de 2026)

### AppxManifest.xml

#### ✏️ Modificações:

1. **Elemento Application**
   ```xml
   ANTES: <Application Id="SnapAway" StartPage="renderer/index.html">
   DEPOIS: <Application Id="SnapAway" Executable="app\SnapAway.exe" EntryPoint="Windows.DesktopApp">
   ```
   - StartPage removido (não é compatível com Desktop Bridge)
   - Executable corretamente apontando para SnapAway.exe
   - EntryPoint adicionado para especificar Desktop app

2. **Visual Elements**
   ```xml
   ANTES: 
   <uap:DefaultTile />
   
   DEPOIS:
   <uap:DefaultTile Wide310x150Logo="assets\Square150x150Logo.png" />
   ```
   - Logo padrão adicionado para tile

3. **Elementos inválidos removidos**
   - `<uap3:VisualElements>` (causava erro de schema)
   - `BackgroundColor="transparent"` (agora em SplashScreen)

#### ✅ Resultado:
- Arquivo valida com MakeAppx sem erros
- Suporta Desktop Bridge apps com runFullTrust

---

### build-appx.js

#### ✏️ Modificações:

1. **Error Handling para MakeAppx**
   ```javascript
   ANTES:
   } catch (error) {
     console.warn('⚠  MakeAppx not available...');
     console.log(`📁 APPX structure available at: ${appxDir}`);
     return; // Exit if packaging failed
   }
   
   DEPOIS:
   } catch (error) {
     console.error('❌ Failed to create APPX package:', error.message);
     console.warn('ℹ️  MakeAppx requires Windows 10 APP Certification Kit');
     process.exit(1);
   }
   ```
   - Mudança de `return` para `process.exit(1)` (exit correto)
   - Mensagens mais descritivas
   - Link para instalação do Windows SDK

2. **Step 7: Signing APPX**
   ```javascript
   ADICIONADO:
   // Verify APPX was created
   if (!fs.existsSync(outputAppx)) {
     console.error('❌ APPX file not found:', outputAppx);
     process.exit(1);
   }
   
   // Verify certificate exists
   if (!fs.existsSync(certPath)) {
     console.error('❌ Certificate file not found:', certPath);
     process.exit(1);
   }
   ```
   - Validações adicionadas antes de tentar assinar
   - Melhor feedback ao usuário

3. **Paths de ferramentas atualizado**
   - Usa Windows SDK bin path completo
   - Suporta múltiplas versões do SDK

#### ✅ Resultado:
- Build processo mais robusto
- Melhor tratamento de erros
- APPX criado com sucesso em 121.44 MB

---

### validate-store-compliance.js

#### ✏️ Modificações:

1. **Adição de BUILD_DIR constant**
   ```javascript
   ADICIONADO:
   const BUILD_DIR = path.join(ROOT_DIR, 'build');
   ```

2. **Step 7: Verificação de app compilado**
   ```javascript
   ADICIONADO:
   console.log('7️⃣  Checking for built app files...');
   const distDir = path.join(ROOT_DIR, 'dist');
   const winUnpacked = path.join(distDir, 'win-unpacked');
   
   if (!fs.existsSync(winUnpacked)) {
     errors.push('Built app not found. Run: npm run build');
   } else {
     const exePath = path.join(winUnpacked, 'SnapAway.exe');
     if (!fs.existsSync(exePath)) {
       errors.push('SnapAway.exe not found in dist/win-unpacked');
     }
   }
   ```

3. **Step 6: IAP configuration check**
   ```javascript
   ADICIONADO:
   if (!pkg.build?.appx) {
     warnings.push('Missing appx configuration in package.json');
   }
   ```

4. **Remoção de duplicação**
   - Removido `const requiredAssets = [...]` duplicado na linha 166
   - Mantida apenas a verificação original de assets

#### ✅ Resultado:
- Validação mais rigorosa
- Verifica presença de executable compilado
- 0 erros críticos, 2 avisos aceitáveis

---

### 🆕 Scripts Novos Criados

#### 1. scripts/verify-submission.js
**Propósito**: Testes de verificação pré-submissão

Testes implementados:
- AppxManifest.xml validation
- package.json configuration
- Built application presence
- IAP addon presence
- Build scripts presence
- APPX package file presence
- Documentation files presence

#### 2. docs/IMPLEMENTATION_REVIEW.md
**Propósito**: Documento de resumo técnico da revisão

Contém:
- Todas as alterações realizadas
- Resultado dos testes (7/7 passou)
- Status de cada componente
- Próximos passos

---

## 📊 Estatísticas da Revisão

| Métrica | Valor |
|---------|-------|
| Arquivos Revisados | 3 |
| Arquivos Corrigidos | 2 |
| Scripts Novos | 1 |
| Documentação Nova | 1 |
| Testes Implementados | 7 |
| Testes Passando | 7/7 (100%) |
| Erros Críticos | 0 |
| Avisos | 2 (aceitáveis) |
| Bugs Corrigidos | 3 |

---

## ✅ Checklist de Revisão

- [x] AppxManifest.xml corrigido
- [x] build-appx.js melhorado
- [x] validate-store-compliance.js atualizado
- [x] Scripts de build testados
- [x] APPX criado com sucesso
- [x] Compliance check passando
- [x] Testes de verificação implementados
- [x] Documentação atualizada
- [x] Sem erros críticos detectados

---

## 🚀 Status Final

```
Revisão Completa: ✅
Todos os testes: ✅ PASSED
Pronto para submissão: ✅ YES

Percentual de Conclusão: 100% ✅
```

---

**Realizado em**: 4 de março de 2026  
**Tempo de revisão**: ~1 hora  
**Status**: ✅ PRONTO PARA SUBMISSÃO NO MICROSOFT STORE
