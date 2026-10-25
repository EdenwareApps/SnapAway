# Listagem otimizada da Microsoft Store

Artefatos e instruções para atualizar a listagem do SnapAway (`9NWCB3QXSBVJ`) com base nos dados
de aquisição do Partner Center — ver [STORE_ANALYTICS.md](../STORE_ANALYTICS.md).

## Arquivos

| Arquivo | O que é |
|---|---|
| `listingData-optimized.csv` | Export da submissão `1152921505702228504` com **76 células alteradas**. Mesmo header, mesmas 453 linhas, mesmos `ID`/`Type`/`default` — pronto para reimportar |
| `optimize-listing.py` | Script que gera o CSV acima a partir do export original. Reexecutável quando a listagem mudar |
| `README.md` | Este arquivo, incluindo o bloco de conteúdo em híndi (`hi`) para colar quando o idioma for adicionado |

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

Validação feita no arquivo gerado: header idêntico, 453 linhas, `Field`/`ID`/`Type`/`default`
preservados linha a linha, nenhum termo de busca duplicado ou acima de 30 caracteres, UTF-8 com BOM
e CRLF em todo o arquivo (inclusive dentro dos campos multilinha, como no export original).

## O que o CSV **não** altera (e por quê)

- **`Title` nos outros 8 idiomas** — mantidos. O gancho `Hide Apps Instantly` / equivalente já
  carrega a palavra-chave principal, e "Boss Key" já está coberto via `SearchTerm`. Alterar o título
  arrisca truncamento na exibição da busca sem ganho comprovado.
- **Screenshots** — só existem 5 de 30 slots. Não é possível otimizar por CSV (as imagens precisam
  ser produzidas). Recomendação registrada na seção 6 do `STORE_ANALYTICS.md`: adicionar par
  antes/depois e um card do que o Pro desbloqueia.
- **Idioma `hi`** — a coluna não é adicionada porque o Partner Center só aceita colunas de idiomas
  que já existem na submissão. Adicionar `hi` em **Listagem → Idiomas** primeiro, depois colar o
  conteúdo de `HINDI.md`.

## Como importar

1. Partner Center → **Apps e jogos** → SnapAway → **Nova submissão** (ou a submissão em rascunho).
2. **Listagem** → menu **⋯** → **Importar listagem** → selecionar `listingData-optimized.csv`.
3. Conferir o resumo do import (deve reportar 453 linhas) e revisar visualmente `en-us` e `pt`.
4. Enviar para certificação.

## Híndi (`hi`) — conteúdo pronto

Pré-requisito: adicionar **Hindi (हिन्दी)** como idioma da listagem. O app já está traduzido
(`hi` existe em `src/language/texts.json`); a Store é o único lugar onde ele falta, apesar de a
Índia representar 24,18% das instalações (501 de 2.070).

| Campo | Conteúdo |
|---|---|
| `Title` | `SnapAway – ऐप्स तुरंत छिपाएं` |
| `ShortDescription` | `निजी ऐप्स खुले रह जाने पर कभी पकड़े न जाएं। एक शॉर्टकट से ऐप्स को स्क्रीन, टास्कबार और Alt+Tab से तुरंत छिपाएं — बंद करने की ज़रूरत नहीं।` |
| `SearchTerm1..7` | `hide apps`, `boss key`, `hide windows`, `window hider`, `privacy screen`, `panic button`, `hide taskbar` |
| `Feature10` | `मुफ़्त: 2 ऐप्स तक छिपाएं · Pro Lifetime: असीमित ऐप्स · एक बार की खरीद, कोई सब्सक्रिप्शन नहीं` |

> Os termos de busca ficam **em inglês** de propósito: a maioria das buscas na Store da Índia é
> feita em inglês, e a listagem em híndi serve para gerar confiança na página, não para competir
> com o `en-us` nas mesmas palavras.

`Description` (parágrafos separados por linha em branco):

```text
निजी ऐप्स खुले रह जाने पर कभी पकड़े न जाएं।

SnapAway आपको Windows पर एक ही शॉर्टकट से ऐप्स तुरंत छिपाने देता है। जैसे ही कोई कमरे में आता है, चुने हुए सभी ऐप्स डेस्कटॉप, टास्कबार और Alt+Tab से गायब हो जाते हैं — और सुरक्षित होते ही उतनी ही तेज़ी से वापस आ जाते हैं।

मुफ़्त संस्करण में आप एक साथ 2 ऐप्स तक छिपा सकते हैं।
Pro Lifetime के साथ असीमित ऐप्स और उन्नत सुविधाएं — एक बार की खरीद, कोई सब्सक्रिप्शन नहीं।

प्रोग्राम बंद करने या अपना काम खोने की ज़रूरत नहीं। SnapAway सब कुछ सुरक्षित रूप से बैकग्राउंड में चलाता रहता है।

चुने हुए ऐप्स तुरंत छिपाने के लिए F6 दबाएं। वापस लाने के लिए Ctrl+F6 दबाएं।

निजता ज़रूरी हो ऐसी रोज़मर्रा की स्थितियों के लिए बेहतरीन: काम, पढ़ाई, वीडियो देखना या अजीब पलों से बचना।

एक पल में ध्यान भटकाने वाली चीज़ें गायब कर दें।
शांत रहें। निजी रहें। नियंत्रण में रहें।

एक बार की खरीद। कोई सब्सक्रिप्शन नहीं।
```

`ReleaseNotes` e demais campos podem ficar em inglês (a Store usa fallback).
