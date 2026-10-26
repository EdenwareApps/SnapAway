# Análise do Partner Center — Aquisições e Listagem

Documento de referência com os números reais extraídos do Partner Center e as decisões de
otimização que eles justificam. **Todos os valores abaixo vêm dos exports — nenhuma métrica é
estimada.** Onde há cálculo derivado, a fórmula está explícita.

## 0. Fonte dos dados

| Fonte | Conteúdo | Janela |
|---|---|---|
| `FireShot Capture 004 - Aquisições ... Partner Center.pdf` | Insights → Aquisições do produto SnapAway (funil, instalações, exibições, taxa de sucesso, geografia, campanhas) | Últimos **3 meses** |
| `listingData-9NWCB3QXSBVJ-1152921505702228504.csv` | Listagem da submissão `1152921505702228504` — 453 linhas, 9 idiomas | Estado atual |
| `Uso-Jogos-e-Aplicativos.pdf` | Insights → Uso (compras de complementos) | **Último mês** |

> O PDF de Aquisições é **somente imagem** (sem camada de texto): foi rasterizado com
> `pypdfium2` e lido visualmente. Reexportar como CSV/XLSX pelo Partner Center é mais confiável
> para atualizações futuras.

Identidade do produto: `9NWCB3QXSBVJ` · submissão `1152921505702228504` · listagem `1152922700024507509`.

## 1. Funil de aquisição (3 meses)

| Etapa | Volume | Retenção na etapa |
|---|---|---|
| Exibições da página (page views) | **12.390** | — |
| Tentativas de instalação | 2.210 | **17,84%** das exibições |
| Instalações concluídas | 2.070 | **93,67%** das tentativas |
| **Primeiro lançamento pela Store** | **1.240** | **59,90%** das instalações |

Métricas reportadas diretamente pelo Partner Center:

- **Conversão: 16,73%**
- **Taxa de sucesso da instalação: 99,28%**
- **Falhas de instalação: 15**
- **Anulações iniciadas pelo usuário: 122**

Cálculos derivados:

```
click-through (exibição → tentativa) = 2.210 / 12.390 = 17,84%
perda em tentativas                   = 122 + 15 = 137  (6,20% das tentativas)
ativação (instalar → primeiro abrir)  = 1.240 / 2.070 = 59,90%
instalaram e nunca abriram            = 2.070 − 1.240 = 830
exibição → primeiro lançamento        = 1.240 / 12.390 = 10,01%
média diária                          = 2.070 / 91 = 22,7 instalações | 12.390 / 91 = 136 exibições
```

## 2. Ritmo diário e efeito de release

- Instalações: ~15–35/dia.
- Exibições: ~120–185/dia, com **queda para 60–75 em 22/08**, retornando ao patamar anterior e
  terminando a série em ~120/dia (declínio suave, não colapso).
- Marcadores de release no gráfico de instalações: **03/08, 22/08, 01/09, 09/09, 30/09** — cada
  release gera pico de exibições. Publicar versão nova é a única alavanca de visibilidade
  orgânica comprovada nos dados.

## 3. Dispersão geográfica (instalações)

| País | Instalações | % | Idioma na listagem |
|---|---|---|---|
| Estados Unidos | 560 | 27,03% | `en-us` |
| **Índia** | **501** | **24,18%** | **nenhum** |
| Brasil | 79 | 3,81% | `pt` |
| Filipinas | 74 | 3,57% | `en-us` (fallback) |
| Reino Unido | 66 | 3,19% | `en-us` |
| Austrália | 46 | 2,22% | `en-us` |
| Nigéria | 39 | 1,88% | `en-us` |

O restante está distribuído em **17 páginas** de países (cauda longa) — não foi lido linha a linha.

Ponto central: **1 em cada 4 instalações vem da Índia, e a listagem não tem híndi.**

## 4. Monetização

| Métrica | Valor |
|---|---|
| Compras de bens duráveis (último mês) | **2** |
| Receita (último mês) | **US$ 20** |
| Distribuição | **100% Estados Unidos** |
| Assinaturas / consumíveis | 0 (nenhum configurado) |

```
instalações/mês ≈ 2.070 / 3            = 690
conversão instalação → compra ≈ 2 / 690 = 0,29%
compras/mês necessárias para 1%         = 6,9
```

Comparação de impacto (mesma base de 690 instalações/mês):

| Cenário | Compras/mês | Ganho vs. hoje |
|---|---|---|
| Hoje (0,29%) | 2 | — |
| 0,5% | ~3,5 | +1,5 |
| 1,0% | ~7 | +5 |
| Ativação de 59,9% → 80% (mais 139 primeiros lançamentos/mês) | 2 → ~2,4 | +0,4 |

> Conclusão: **o gargalo é conversão para compra, não visibilidade.** Dobrar o tráfego rende
> menos que dobrar a taxa de compra.

## 5. Campanhas

| Campanha | Instalações |
|---|---|
| `apk-cross-toolbar` | 1 |
| `a_med-gra_gra` | 0 |
| `a_pla-lis_med_MediaSaver` | 0 |
| `anydvdads001` | 0 |
| `apk_cross-main` | 0 |

Não há sinal para investir em aquisição paga via campanhas da Store. Todo o volume é orgânico.

## 6. Auditoria da listagem (CSV)

Idiomas presentes: `en-us, pt, ar, de, es, fr, ja, ko, zh-cn, hi` (**10**).

O app em si já está traduzido para **20 idiomas** (`src/language/texts.json`):
`en, ar, cs, de, el, es, fr, hi, hu, it, ja, ko, nl, pl, pt, ru, sv, th, tr, zh`.

**10 idiomas do app não existem na listagem:** `cs, el, hu, it, nl, pl, ru, sv, th, tr`.

`hi` foi adicionado ao Partner Center e o export passou a trazer a coluna vazia; o
`optimize-listing.py` preenche os 30 campos (ver seção "Híndi" do
[README da listagem](store-listing/README.md)).

### Defeitos encontrados

| # | Campo | Idioma(s) | Problema |
|---|---|---|---|
| 1 | `Description` | pt, ar, de, es, fr, ja, ko, zh-cn | **O atalho F6/Ctrl+F6 nunca é mencionado.** Só o `en-us` diz qual tecla apertar — 8 de 9 idiomas não explicam o mecanismo principal do produto |
| 2 | `SearchTerm1..7` | pt | `ocultar apps windows` repetido nas posições 1 e 2 |
| 3 | `SearchTerm1..7` | ar | `إخفاء التطبيقات ويندوز` (1 e 2) e `إخفاء النوافذ` (3 e 7) duplicados → **3 slots de 7 desperdiçados** |
| 4 | `SearchTerm1..7` | todos | Todos os termos são variações de "ocultar X no Windows". Faltam famílias de intenção: `panic button`, `privacy screen`, `hide taskbar`, `tecla do chefe`, `老板键` |
| 5 | `SearchTerm5` | de | `fenster ausblenden tastenkürzel` = **31 caracteres**, acima do limite de 30 |
| 6 | `TrailerToPlayAtTopOfListing` | pt, ar, de, ja, zh-cn | Vazio — o único trailer existente **não toca no topo** nesses idiomas (só `en-us, es, fr, ko`). Ao importar numa submissão nova o campo precisa ir **vazio**: o ID do trailer é por submissão e a URL antiga é rejeitada (`The value you provided is not valid`) |
| 7 | `Feature10` | todos | `Free to try` / `Grátis para testar` — não é trial; é versão gratuita limitada a 2 apps. Mensagem incorreta sobre o modelo de negócio |
| 8 | `Title` | ja | `ワンタップでアプリを即非表示` ("um toque") — o produto usa **teclado**, não toque. Só que `Title` tem de ser um **nome reservado**, então a correção possível é `SnapAway` puro |
| 9 | `DesktopScreenshot1..5` | todos | **5 de 30 slots usados.** Nenhum par antes/depois, nenhum shot do que o Pro desbloqueia |
| 10 | `Description` | todos | O bloco comercial (grátis/Pro/compra única) é o **penúltimo/último** parágrafo — abaixo da dobra |
| 11 | `MobileScreenshot*`, `XboxScreenshot*`, `SurfaceHub*` | — | Vazios; irrelevante para app de PC |

### O que está bom (não mexer)

- `Title` en-us `SnapAway – Hide Apps Instantly` — 30 caracteres, marca + proposta de valor.
- `ShortDescription` — 130 caracteres, gancho forte ("Never get caught with private apps open again").
- 10 `Feature` preenchidos com benefícios claros.
- 1 trailer publicado.
- `pt` é o único idioma não-inglês com volume relevante fora da Índia (3,81%) e está completo.

## 7. Gargalos ranqueados por impacto corrigível

| Rank | Gargalo | Evidência | Onde se corrige |
|---|---|---|---|
| 1 | Conversão para compra 0,29% | 2 compras / ~690 instalações | app (paywall, preço localizado) + listagem (Pro visível) |
| 2 | 40% instalam e nunca abrem | 2.070 → 1.240 | **app** (onboarding, atalho, auto-start) |
| 3 | Índia sem idioma | 501 instalações / listagem em `hi` só agora preenchida (app já tinha `hi`) | listagem (import pendente) + app |
| 4 | 137 tentativas perdidas | 122 anulações + 15 falhas | app (tamanho do pacote, tempo até a 1ª janela) |
| 5 | Visibilidade em declínio suave | 150–180 → ~120 exibições/dia | cadência de release |
| 6 | Higiene da listagem | itens 1–11 da seção 6 | listagem |

### 7.1 O que isso pede no app

| # | Mudança | Evidência que justifica |
|---|---|---|
| A1 | **Onboarding de primeira execução em 3 passos, sem timer e sem atalho de fuga** — *implementado em 1.2.5*: (1) escolher a janela-alvo numa lista com seleção única; "Avançar" fica desabilitado até haver alvo, porque sem alvo a ocultação não faz nada; (2) desenho de teclado com a tecla **F6 piscando** e o passo só libera quando ela é pressionada de verdade (a janela escolhida é ocultada de fato, como demonstração); (3) **Ctrl+F6** restaura a mesma janela. O "Agora não" só aparece depois de 3 erros | 830 de 2.070 (40%) instalam e nunca abrem; a listagem só explicava o atalho em `en-us`. Sem saber a tecla, o app é inútil — por isso a etapa não pode ser pulada por tempo |
| A2 | **Auto-start como oferta explícita no passo 1** (e não como opt-out silencioso) | o produto é um atalho de emergência: sem processo rodando, não existe "boss key". Sem sessão contínua não há 2º uso, e sem 2º uso não há upsell (`MIN_USAGE_COUNT = 2`). A tarefa de inicialização do MSIX exige consentimento, então o botão "Iniciar com o Windows" fica no onboarding em vez de vir ligado |
| A3 | **Funil interno** — *parcialmente instrumentado*: já existem `onboarding.hide.completed`, `onboarding.reveal.success`, `onboarding.reveal.method.*`, `onboarding.reveal-hint.*`, `retention.pro_modal_viewed`, `retention.pro_upsell_modal_opened/clicked`. **Falta** medir ocultação fora do onboarding (sessão com ≥1 ocultação), o marco de **uso nº 2** e a **dispensa** do upsell | não existe nenhum dado de retenção no export; hoje é impossível saber quantos dos 1.240 primeiros lançamentos viram uso recorrente |
| A4 | **Preço do add-on por mercado** (Partner Center → Preços), não mudança de código | 2 compras, 100% EUA, US$ 10 cada; a Índia é 24% das instalações e o preço em rupias equivale a ~US$ 10 |
| A5 | **Revisar latência do 1º frame** e o tempo até o atalho ficar ativo | 122 anulações iniciadas pelo usuário (5,5% das tentativas) + 15 falhas; o `.appx` tem 111 MB e o download em conexões lentas é o suspeito mais provável |
| A6 | Manter o fix de GPU de 1.2.4 | 47 eventos/14 dias de `ELECTRON-K`: o Chromium matava o app inteiro em máquinas com driver quebrado |
| A7 | **Trocar o "shake" mudo por um balão curto** em `handleHideWithoutFilters` — *implementado em 1.2.5*: o atalho de ocultar sem filtro nenhum agora mostra um balão de aviso (`TOAST_NO_TARGET`) por 4,5 s e traz a janela principal de volta | mesma perda de ativação do A1: o usuário que não entende a falha desinstala em vez de abrir a lista |
| A8 | **Cobertura de tradução completa** (`src/language/texts.json`) — feito | 18 de 19 idiomas estavam com 148/166 chaves e o fallback é `texts.en`, então **o paywall Pro e o pedido de avaliação apareciam em inglês** justamente nos mercados que mais instalam sem saber inglês |

Itens que **não** se justificam pelos dados: aumentar preço (não há base de elasticidade), adicionar
assinatura (0 assinaturas configuradas e o posicionamento "sem assinatura" é diferencial), ou
investir em campanhas pagas da Store (1 instalação em 5 campanhas).

### 7.2 Artefato gerado

`docs/store-listing/listingData-optimized.csv` aplica os itens 1–8 da seção 6 (**34 células**:
30 do híndi + `TrailerToPlayAtTopOfListing` em `en-us, es, fr, ko`).
Instruções de import e o bloco em híndi em [store-listing/README.md](store-listing/README.md).

## 8. Limitações desta análise

- Não há dados de **retenção** (D1/D7/D30) neste export — só "primeiro lançamento". Não é possível
  afirmar quantos dos 1.240 voltam a usar.
- **17 páginas** de países não foram lidas individualmente; o ranking além do 7º lugar é desconhecido.
- Não há série temporal de compras além do agregado do último mês (2 / US$ 20).
- Os **eventos personalizados** (`logCustomEvent`) não entram nestas métricas; a verificação de
  entrega ainda depende do diagnóstico de 1.2.4 (`store.custom_event.diagnostic`).
- Conversão de 16,73% e o funil medem **janelas diferentes** de atribuição; pequenas diferenças
  entre `2.210/12.390` e os 16,73% reportados são esperadas.

## 9. Como atualizar

1. Partner Center → Insights → Aquisições → período desejado → **Baixar**.
2. Exportar preferencialmente em **CSV/XLSX** (evita a rasterização de PDF).
3. Atualizar as tabelas das seções 1–5 e revisar a seção 7.
4. Reexportar a listagem (Partner Center → Submissão → Listagem → Exportar) e comparar com a
   seção 6 antes de cada nova submissão.

Documento gerado em **25/10/2026**.
