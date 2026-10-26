# Listagem otimizada da Microsoft Store

Artefatos e instruções para atualizar a listagem do SnapAway (`9NWCB3QXSBVJ`) com base nos dados
de aquisição do Partner Center — ver [STORE_ANALYTICS.md](../STORE_ANALYTICS.md).

## Arquivos

| Arquivo | O que é |
|---|---|
| `listingData-optimized.csv` | Export da submissão `1152921505702228504` (já com o idioma `hi`) com as otimizações abaixo aplicadas — **70 células alteradas** nesta rodada. Mesmo header, mesmas 453 linhas, mesmos `ID`/`Type`/`default` — pronto para reimportar |
| `optimize-listing.py` | Script que gera o CSV acima a partir do export original. Reexecutável quando a listagem mudar |
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
| 8 | 29 campos | hi | **Preenchido do zero**: `Description`, `ShortDescription`, `ShortTitle`, `VoiceTitle`, `DevStudio`, `CopyrightTrademarkInformation`, `AdditionalLicenseTerms`, 5 legendas de screenshot, `Feature1..10` e `SearchTerm1..7` (as `ReleaseNotes` ficam no item 11). `Title` fica `SnapAway` (nome reservado, igual ao `ja`) |
| 9 | `DesktopScreenshotCaption2..4` | pt, ar, de, es, fr, ko, zh-cn | **Ordem normalizada**. O export traz uma ordem diferente por idioma (aparecem as seis permutações de "botão flutuante", "temas" e "personalizar"), então a legenda caía no screenshot errado em 7 idiomas. Agora todos seguem a ordem do `en-us`: 2 = botão flutuante, 3 = temas, 4 = personalizar |
| 10 | `DesktopScreenshotCaption5` | todos os 10 | **Texto corrompido no export**. A legenda foi quebrada na vírgula em algum editor e vazou uma coluna para a direita: o `pt` terminava no `ar`, o `ar` no `de`, o `de` no `es`, o `es` no `ja`, o `fr` no `zh-cn` — e cada idioma ficou com um fragmento, em outro idioma. Reescrita em todos, **sem vírgulas** (separador virou `—`) para o problema não voltar |
| 11 | `ReleaseNotes` | todos os 10 | **Notas de 1.2.5**. O export carrega as notas de 1.2.4, que descrevem correções que quem instalar 1.2.5 já tem. Substituídas pelo que a versão entrega: tour guiado com a tecla física, aviso de janela-alvo ausente e as 18 traduções que faltavam |

Validação feita no arquivo gerado: header idêntico, 453 linhas, `Field`/`ID`/`Type`/`default`
preservados linha a linha, nenhum termo de busca duplicado ou acima de 30 caracteres, nenhuma
legenda acima de 200 caracteres, nenhuma nota de versão acima de 1500 caracteres, UTF-8 com BOM e
CRLF em todo o arquivo (inclusive dentro dos campos multilinha, como no export original). O diff
real contra o export é de **70 células**: 32 legendas de screenshot, 10 `ReleaseNotes`, 4 de
`TrailerToPlayAtTopOfListing`, 10 `Feature1..10`, 7 `SearchTerm1..7` e 7
campos de texto do `hi` (`Description`, `ShortTitle`, `VoiceTitle`, `ShortDescription`, `DevStudio`,
`CopyrightTrademarkInformation`, `AdditionalLicenseTerms`). O script registra **71** alterações no
log porque reaplica `Title` do `ja` mesmo quando o valor já está igual.

## O que o CSV **não** altera (e por quê)

- **`Title` nos outros 8 idiomas** — mantidos. O gancho `Hide Apps Instantly` / equivalente já
  carrega a palavra-chave principal, e "Boss Key" já está coberto via `SearchTerm`. Alterar o título
  arrisca truncamento na exibição da busca sem ganho comprovado.
- **Screenshots** — só existem 5 de 30 slots. Não é possível otimizar por CSV (as imagens precisam
  ser produzidas). Recomendação registrada na seção 6 do `STORE_ANALYTICS.md`: adicionar par
  antes/depois e um card do que o Pro desbloqueia.

## Como importar

1. Partner Center → **Apps e jogos** → SnapAway → **Nova submissão** (ou a submissão em rascunho).
2. **Listagem** → menu **⋯** → **Importar listagem** → selecionar `listingData-optimized.csv`.
3. Conferir o resumo do import (deve reportar 453 linhas) e revisar visualmente `en-us` e `pt`.
4. Enviar para certificação.

## Híndi (`hi`) — preenchido pelo script

O idioma já foi adicionado à listagem, então o export atual traz a coluna `hi` vazia e o script a
preenche inteira (30 campos). Decisões:

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

`ShortDescription`, `Feature1..10` e a legenda 1 ficam em `HINDI`, no topo de
`optimize-listing.py`; as legendas 2..5 dos 10 idiomas ficam em `CAPTION_FLOATING`,
`CAPTION_THEMES`, `CAPTION_CUSTOMIZE` e `CAPTION_RESTORE`, e as notas de versão em
`RELEASE_NOTES`. É a única fonte, para não haver duas versões do texto.
