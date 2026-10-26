# Listagem otimizada da Microsoft Store

Artefatos e instruções para atualizar a listagem do SnapAway (`9NWCB3QXSBVJ`) com base nos dados
de aquisição do Partner Center — ver [STORE_ANALYTICS.md](../STORE_ANALYTICS.md).

## Arquivos

| Arquivo | O que é |
|---|---|
| `listingData-optimized.csv` | Export **atual** da submissão `1152921505702228504` (já com o idioma `hi` importado) com as otimizações abaixo aplicadas — **31 células alteradas** em relação a ele. Mesmo header, mesmas 453 linhas, mesmos `ID`/`Type`/`default` — pronto para reimportar |
| `optimize-listing.py` | Script que gera o CSV acima a partir do export original. Reexecutável quando a listagem mudar |
| `addonListingData-optimized.csv` | Export da submissão `1152921505702237352` **do add-on** `SnapAwayPro` (`9NNLVZPCLLTZ`) com `Title`, `Description` e `StoreLogo300x300` nos 10 idiomas — **28 células alteradas** |
| `optimize-addon-listing.py` | Script que gera o CSV do add-on. O prefixo das URLs de mídia é lido da célula `en-us` do export, então ele sobrevive à troca de submissão |
| `README.md` | Este arquivo, incluindo o conteúdo em híndi (`hi`) que o script agora preenche |

Regenerar:

```powershell
python docs\store-listing\optimize-listing.py "$env:USERPROFILE\Downloads\listingData-<ID>-<submission>.csv"
```

## O que o CSV altera

| # | Campo | Idiomas | Antes → Depois |
|---|---|---|---|
| 1 | `Description` | pt, ar, de, es, fr, ja, ko, zh-cn | **Não citava F6/Ctrl+F6** → parágrafo do atalho inserido na 4ª posição |
| 2 | `Description` | todos os 9 | Bloco "grátis até 2 apps / Pro Lifetime" era o penúltimo parágrafo → movido para a **3ª posição** (acima da dobra). A linha "compra única, sem assinatura" continua no rodapé |
| 3 | `SearchTerm1..7` | todos os 9 | Duplicatas removidas (`pt` 2×, `ar` 2 pares) e famílias de intenção ausentes adicionadas: `panic button`, `privacy screen`, `hide taskbar`, `tecla do chefe`, `老板键`, `老板来了` |
| 4 | `SearchTerm5` | de | `fenster ausblenden tastenkürzel` (31 chars, acima do limite) → `chef taste` |
| 5 | `Feature10` | todos os 9 | `Free to try` (não é trial) → `Free: hide up to 2 apps · Pro Lifetime: unlimited apps · one-time purchase, no subscription` |
| 6 | `TrailerToPlayAtTopOfListing` | todos os 9 | **Limpo**. O ID do trailer vale só para a submissão em que foi enviado: ao importar numa submissão seguinte o Partner Center responde `The value you provided is not valid` e bloqueia os 5 idiomas. Deixe vazio e escolha o trailer na UI |
| 7 | `Title` | ja | `ワンタップでアプリを即非表示` ("um toque", teclado não é toque) → `SnapAway`. O `Title` precisa ser um **nome de produto reservado**; qualquer sufixo localizado é rejeitado com `Title must be one of your reserved product names` |
| 8 | 18 campos | hi | **Preenchido do zero**: `Description`, `ShortDescription`, `ShortTitle`, `VoiceTitle`, `DevStudio`, `CopyrightTrademarkInformation`, `AdditionalLicenseTerms`, legenda do screenshot 1 e `Feature1..9`; `Feature10`, `SearchTerm1..7`, as legendas 2..5 e as `ReleaseNotes` vêm dos passos 3, 4, 8 e 9, que rodam para os 10 idiomas. `Title` fica `SnapAway` (nome reservado, igual ao `ja`) |
| 9 | `DesktopScreenshotCaption2..4` | pt, ar, de, es, fr, ko, zh-cn, hi | **Legenda presa à imagem do slot**. A rodada anterior reordenou só as legendas para a ordem do `en-us` (flutuante, temas, personalizar), mas o export atual mostra as imagens na ordem **temas, personalizar, botão flutuante** nos 9 idiomas — resultado: em 7 idiomas o texto ficou embaixo do screenshot errado. Agora as legendas 2..4 seguem a ordem real das imagens: 2 = temas, 3 = personalizar, 4 = botão flutuante |
| 10 | `DesktopScreenshotCaption5` | todos os 10 | **Texto corrompido no export**. A legenda foi quebrada na vírgula em algum editor e vazou uma coluna para a direita: o `pt` terminava no `ar`, o `ar` no `de`, o `de` no `es`, o `es` no `ja`, o `fr` no `zh-cn` — e cada idioma ficou com um fragmento, em outro idioma. Reescrita em todos, **sem vírgulas** (separador virou `—`) para o problema não voltar |
| 11 | `ReleaseNotes` | todos os 10 | **Notas de 1.2.5**. O export carrega as notas de 1.2.4, que descrevem correções que quem instalar 1.2.5 já tem. Substituídas pelo que a versão entrega: tour guiado com a tecla física, aviso de janela-alvo ausente e as 18 traduções que faltavam |
| 12 | `DesktopScreenshot1..5` | hi | **Mídias apontadas para as do `en-us`**. As imagens são ativos compartilhados da submissão (o mesmo `listingassets/<id>` aparece nos 9 idiomas). A importação funcionou: o Partner Center aceitou a URL do `en-us` e reescreveu sozinho o prefixo para o listing do `hi` (`1152922700028820928`). O script agora compara o **ID do asset**, não a URL, e só escreve quando o slot está vazio ou aponta para outro asset — regerar sobre um export já importado não muda nada. Nesta rodada a única escrita é nos slots 2..4 do `hi`, que estavam na ordem antiga (flutuante, temas, personalizar) |
| 13 | `StoreLogo300x300`, `PromoImage1920x1080`, `OverrideLogosForWin10` | hi | **Mídia e flag que o idioma novo não herda.** O `hi` era o único idioma sem logo, sem imagem promocional e com `OverrideLogosForWin10 = False`. Logo e promo recebem a URL do `en-us` (mesmo mecanismo dos screenshots, aceito também para logos — ver `STORE_LISTING_IMPORT_ERRORS.md` §4) e a flag vai para `True`, igual aos outros 9 idiomas |

Validação feita no arquivo gerado: header idêntico, 453 linhas, `Field`/`ID`/`Type`/`default`
preservados linha a linha, nenhum termo de busca duplicado ou acima de 30 caracteres, nenhuma
legenda acima de 200 caracteres, nenhuma nota de versão acima de 1500 caracteres, UTF-8 com BOM e
CRLF em todo o arquivo (inclusive dentro dos campos multilinha, como no export original). O diff
real contra o export atual é de **31 células**: 21 legendas de screenshot (2..4 de `pt`, `ar`, `de`,
`es`, `fr`, `ko`, `zh-cn` e `hi`), 4 de `TrailerToPlayAtTopOfListing`, 3 slots de screenshot do
`hi` (2..4) e as 3 células de mídia/flag do `hi`. O log do script lista exatamente essas 31 — as
comparações normalizam CRLF, então `Description`, `ReleaseNotes` e `Title` do `ja` não aparecem
mais como alteração quando já estão iguais.

A rodada anterior partiu do export **anterior à importação** e alterou 75 células (incluindo os 35
campos de texto/mídia do `hi` e as notas de versão). Este arquivo já é o resultado acumulado
daquelas mudanças **mais** as 31 desta rodada; o export atual confirma que todas as anteriores
entraram (notas de 1.2.5, `Title` do `ja`, termos de busca, `Feature10`, descrições e os 5
screenshots do `hi`).

## O que o CSV **não** altera (e por quê)

- **`Title` nos outros 8 idiomas** — mantidos. O gancho `Hide Apps Instantly` / equivalente já
  carrega a palavra-chave principal, e "Boss Key" já está coberto via `SearchTerm`. Alterar o título
  arrisca truncamento na exibição da busca sem ganho comprovado.
- **Screenshots** — só existem 5 de 30 slots, e as imagens continuam sendo as mesmas (não é
  possível produzir imagem por CSV). O CSV só **aponta** o `hi` para as mídias compartilhadas do
  `en-us`. Recomendação registrada na seção 6 do `STORE_ANALYTICS.md`: adicionar par antes/depois e
  um card do que o Pro desbloqueia.
- **Trailer no topo** — `TrailerToPlayAtTopOfListing` é limpo em `en-us`, `es`, `fr` e `ko` (os
  únicos com trailer): o campo é o ponteiro de autoplay e o Partner Center rejeita o ID quando a
  submissão muda. O trailer em si (`Trailer1`) é preservado; o toggle "tocar no topo" precisa ser
  religado na UI depois do import.
- **Logo e imagem promocional dos outros 8 idiomas** — cada idioma tem o próprio upload e está
  preenchido; só o `hi` estava vazio.

## Como importar

1. Partner Center → **Apps e jogos** → SnapAway → **Nova submissão** (ou a submissão em rascunho).
2. **Listagem** → menu **⋯** → **Importar listagem** → selecionar `listingData-optimized.csv`.
3. Conferir o resumo do import (deve reportar 453 linhas) e revisar visualmente `en-us` e `pt`.
4. Enviar para certificação.

## Listagem do add-on (`SnapAwayPro`)

O add-on tem listagem própria e ela é **independente** da listagem do app — o paywall lê título e
descrição da Store no locale do usuário, então antes disso o card Pro aparecia em inglês no meio de
uma interface traduzida.

- Só três campos: `Title`, `Description` e `StoreLogo300x300`. O resto do template vem em branco.
- **`Description` tem limite de 200 caracteres** (não 10.000 — a mensagem de erro do Partner Center
  mostra o número errado; ver [STORE_LISTING_IMPORT_ERRORS.md](../STORE_LISTING_IMPORT_ERRORS.md)
  §2). O script aborta se algum idioma passar disso.
- 10 colunas de idioma: `en-us`, `hi`, `pt`, `ar`, `zh`, `fr`, `de`, `ja`, `ko`, `es`. Aqui o
  Partner Center usa **`zh`**, não `zh-cn` como na listagem do app.
- Todo idioma adicionado nasce **vazio** — nada é herdado do `en-us`. Por isso o script preenche os
  três campos em todos eles.
- `StoreLogo300x300` é um ativo compartilhado: a mesma URL do `en-us` vale para todos os idiomas,
  mesmo mecanismo aceito na listagem do app.
- A `Description` do `en-us` prometia `future Snapcover improvements` (nome do repositório, não do
  produto) e foi reescrita com a lista real de recursos Pro.

Regenerar:

```powershell
python docs\store-listing\optimize-addon-listing.py "$env:USERPROFILE\Downloads\listingData-9NNLVZPCLLTZ-<submission>.csv"
```

## Híndi (`hi`) — preenchido pelo script

O idioma já foi adicionado à listagem, então o export atual traz a coluna `hi` e o script preenche
as células dela. Na primeira importação foram 35 células (30 campos de texto + os 5 screenshots);
agora entram mais `StoreLogo300x300`, `PromoImage1920x1080` e `OverrideLogosForWin10`. Decisões:

| Campo | Valor | Por quê |
|---|---|---|
| `Title` | `SnapAway` | só aceita **nome reservado**; não existe nome reservado em híndi, então repetimos a solução do `ja` |
| `ShortTitle`, `VoiceTitle` | `SnapAway` | marca, não se traduz |
| `DevStudio` | `Edenware — https://edenware.app` | idêntico em todos os idiomas |
| `AdditionalLicenseTerms` | link para `https://edenware.app/snapaway/en/` | `/snapaway/hi/` ainda responde 404 — apontar para lá quebraria o link na página da Store |
| `SearchTerm1..5` | `ऐप छुपाने वाला ऐप`, `विंडो छुपाएं शॉर्टकट`, `बॉस की विंडो`, `टास्कबार छुपाएं`, `प्राइवेसी स्क्रीन` | busca em devanágari, que é o que o usuário híndi digita |
| `SearchTerm6..7` | `boss key windows`, `chhupane wala app` | boa parte das buscas na Índia é feita em latim/transliteração; as duas formas ficam cobertas |

`Description` (8 parágrafos, mesma estrutura do `en-us`, com o bloco comercial na 3ª posição e o
parágrafo do F6/Ctrl+F6):

```text
निजी ऐप्स खुले रह जाने पर कभी पकड़े न जाएं।

SnapAway आपको Windows पर एक ही शॉर्टकट से ऐप्स तुरंत छुपाने देता है। जैसे ही कोई कमरे में आता है, चुने हुए सभी ऐप्स डेस्कटॉप, टास्कबार और Alt+Tab से गायब हो जाते हैं — और सुरक्षित होते ही उतनी ही तेज़ी से वापस आ जाते हैं।

मुफ़्त संस्करण में एक बार में 2 ऐप्स तक छुपाए जा सकते हैं।
असीमित ऐप्स और उन्नत सुविधाओं के लिए Pro Lifetime में अपग्रेड करें। कोई सदस्यता नहीं।

प्रोग्राम बंद करने या अपना काम खोने की ज़रूरत नहीं। SnapAway सब कुछ सुरक्षित रूप से बैकग्राउंड में चलाता रहता है, ताकि नियंत्रण हमेशा आपके पास रहे।

चुने हुए ऐप्स तुरंत छुपाने के लिए F6 दबाएं। उन्हें फिर दिखाने के लिए Ctrl+F6 दबाएं।

उन पलों के लिए बिल्कुल सही जब निजता ज़रूरी हो: काम, पढ़ाई, वीडियो देखना या अजीब स्थितियों से बचना।

पलक झपकते ही ध्यान भटकाने वाली चीज़ें गायब।
शांत रहें। निजी रहें। नियंत्रण में रहें — तुरंत।

एक बार की खरीद। कोई सदस्यता नहीं।
```

`ShortDescription`, `Feature1..9` e a legenda 1 ficam em `HINDI`, no topo de
`optimize-listing.py`; as legendas 2..5 dos 10 idiomas ficam em `CAPTION_FLOATING`,
`CAPTION_THEMES`, `CAPTION_CUSTOMIZE` e `CAPTION_RESTORE`, as notas de versão em `RELEASE_NOTES`,
a mídia reaproveitada do `en-us` em `LOGO_FIELDS`/`HI_LISTING_ID` e a flag em
`OVERRIDE_LOGOS_WIN10`. É a única fonte, para não haver duas versões do texto.

> **Ordem dos screenshots 2..4.** O Partner Center devolve no export os slots na ordem em que estão
> na listagem — hoje **temas, personalizar, botão flutuante** nos 10 idiomas. Se a ordem for mudada
> na UI, as legendas ficam dessincronizadas: regenere o CSV a partir do export novo e ajuste o
> mapeamento do passo 8 de `optimize-listing.py` para a ordem que o export mostrar. Legenda e imagem
> andam sempre juntas pelo slot, nunca por posição fixa.
