# Submissão de listagem ao Microsoft Store (CSV / pasta) — erros e armadilhas

Referência de tudo que já quebrou (ou quase) ao exportar/importar a **Store listing** do
Partner Center por **CSV** ou por **pasta** ("Import folder"). Vale para SnapAway e SonicAura —
o formato e o comportamento do Partner Center são os mesmos.

> Regra de ouro: **o Partner Center não diz qual célula está errada.** Ele devolve um erro
> genérico e cabe a nós isolar por bissecção. Por isso cada seção abaixo termina com o sintoma.

---

## 0. Anatomia do CSV

Header do export (a ordem importa, não reordene):

```
Field,ID,Type (Tipo),default,en-us,pt,ar,de,es,fr,ja,ko,zh-cn
```

- **1 coluna por idioma JÁ criado** na submissão ("Add/remove languages"). Se o idioma não
  existe ainda, **não existe coluna** para ele — e não adianta inventar a coluna.
- `Type (Tipo)` = dica de UI (Texto / Caminho relativo…). **Não é dado**; não preencher.
- `default` fica **vazio**. As colunas de idioma é que carregam o conteúdo.
- **Nunca reconstrua o header** a partir do zero: um script que reescreve o header derruba as
  colunas de idiomas que não estavam previstas. Só regenere se o export tiver exatamente o
  conjunto de colunas esperado.
- **Nunca altere `Field` nem `ID`.** Só as células de conteúdo.

### Codificação e quebras de linha

- Arquivo é **UTF-8 com BOM** (`utf-8-sig`). O BOM tem de sobreviver a qualquer edição.
- Export fresco usa **CRLF** como separador de registros **e dentro de campos multi-linha
  quoted** (Description, ReleaseNotes, …).
- Um **round-trip completo** (parsear e re-serializar o CSV) **normaliza tudo para CRLF** e
  pode mexer em aspas. Por isso a edição preferida é **cirúrgica, byte a byte**, tolerando
  LF e CRLF ao casar o trecho.

### Aspas

- Campo de valor único **sem vírgula não é quoted** no export.
- Ao **inserir texto com vírgula**, a célula **precisa ganhar aspas**.
- Campos multi-linha (Description) são sempre quoted e podem ter `\n\n` internos.

---

## 1. Erros de arquivo (mensagens reais → causa)

| Mensagem / sintoma | Causa provável | Correção |
| --- | --- | --- |
| `Não foi possível importar as listagens dos idiomas a seguir devido a erros no arquivo` **com a lista de idiomas VAZIA** | Erro de arquivo que a página **não detalha** (não diz a célula) | Bisseção (ver §7). Ex.: um `SearchTerm` em pt com 4 palavras derrubou o import inteiro |
| `The value you provided is not valid` | Campo de **asset com URL híbrida** ou valor fora do tipo aceito | Use a URL inteira de um único idioma (§4) |
| `The name is not available` (ao criar o produto) | Nome de listagem **reservado** e único em toda a Store | Escolher outro nome ou pedir liberação em `reportapp@microsoft.com` |
| Import "passa" mas o export seguinte volta vazio/diferente | O import **substitui a coluna inteira** (§3) | Reenviar um CSV **completo** para cada idioma tocado |

**Sintoma clássico do erro genérico:** a página lista os idiomas e a lista aparece vazia —
não há como saber o campo pela UI. Só bissecção resolve.

---

## 2. Regras de conteúdo que reprovam

Limites (doc MS):

| Campo | Limite |
| --- | --- |
| Description | 10.000 chars — **não aceita URL nem HTML** |
| What's new / ReleaseNotes | 1.500 chars (deixar **vazio na primeira** submissão) |
| Feature1..Feature20 | ≤ 200 chars cada (sem bullets próprios) |
| ShortTitle | 50 chars |
| ShortDescription | ideal < 270 (limite 1.000) |
| SearchTerm1..SearchTerm7 | até 7 termos |

Regras medidas na prática:

- **`SearchTerm` com até 3 palavras.** Medido contra **118 termos já aceitos** (9 idiomas da
  SnapAway): **nenhum passa de 3 palavras**. Um `SearchTerm4` = *"desktop reagindo à música"*
  (4 palavras) foi o que fez o import falhar. Termos de 2–3 palavras passam.
- **Sem marcas de terceiros** (Spotify/YouTube/nomes de concorrentes) — tanto em Description
  quanto em SearchTerms. Prefira genéricos: *"a music service, a browser, a media player…"*.
- **Sem URL/HTML na Description** — inclusive nada de links de EULA no corpo; o campo certo é
  `AdditionalLicenseTerms`.
- `Title` deve ser **exatamente o nome reservado** no Partner Center (é o que aparece em
  `apps.microsoft.com/detail/<StoreId>`). Se o reservado não bate com o nome do produto, a
  célula `Title` muda.
- Valide limites **no gerador**, antes de gravar (contagem por campo).

> Exemplo de regra de produto (não confundir com regra da Store): SnapAway FREE oculta **até
> 2 apps** e PRO é pagamento único vitalício. Nunca escrever "3 apps".

---

## 3. O import é DESTRUTIVO (substitui a coluna inteira)

Este é o erro mais caro já pago:

- Importar um CSV **substitui a coluna daquele idioma inteira** pelo que o arquivo diz.
- Quem importa por último vence.
- **Medido:** importar `v2` (25 campos pt) e depois `v4` (8 campos pt) → o export seguinte
  voltou com **só os 8 campos**. Title/VoiceTitle/ShortDescription/DevStudio/Copyright/
  AdditionalLicenseTerms/Features foram **apagados**.
- **Medido:** `SearchTerm`s preenchidos em linhas 1, 2, 3, 5, 6, 7 voltaram **compactados** em
  1..6 (os buracos somem).

Consequência prática:

1. O arquivo a importar tem de estar **COMPLETO para cada idioma que ele toca**.
2. Não importe "um campo só" achando que faz merge — faz replace.
3. Se precisar corrigir 1 célula, gere o CSV inteiro daquele idioma com o valor corrigido.

---

## 4. Assets: screenshots, logos e vídeos

Tipo do campo = *"Relative path (or URL to file in Partner Center)"*.

- **URLs externas (seu site) NÃO são aceitas.**
- Duas formas válidas de URL de asset:
  1. A **URL inteira do próprio idioma**: `listings/{id do idioma}/listingassets/{id do idioma}`.
  2. A **URL inteira do en-us copiada** para os outros idiomas (reuso aceito pelo suporte MS).
- **URL híbrida é rejeitada** (`The value you provided is not valid`): pegar `listings/{id do
  idioma}` mas manter `listingassets/{id do en-us}` — não misture.
- **Confirmado na prática (SnapAway, 10/2026)**: a URL inteira do `en-us` foi copiada para a coluna
  `hi` nos 5 screenshots e no logo/promo, e o import aceitou. O export seguinte veio com o prefixo
  **reescrito pelo próprio Partner Center** para o listing do híndi
  (`listings/1152922700028820928/listingassets/{id do en-us}`) — ou seja, a forma "híbrida" que
  aparece num export é gerada pelo servidor, não é o que se deve submeter. Consequência prática:
  compare o **`listingassets/<id>`** (o ativo), não a URL completa, ao decidir se uma célula já está
  preenchida; senão o script regrava a mesma mídia em toda execução.
- Screenshots são **ativos compartilhados** (o mesmo `listingassets/<id>` em todos os idiomas);
  `StoreLogo300x300` e `PromoImage1920x1080` são **upload por idioma** — a URL do `en-us` serve como
  reuso, mas um idioma novo nasce vazio e com `OverrideLogosForWin10 = False`.
- `StoreLogo300x300` precisa de **referência válida** aceita pelo import.
- Screenshots: mínimo 3, recomendado até 9; **1920×1080 PNG** é o padrão usado.
- Thumbs de vídeo também 1920×1080; vídeo H.264 + AAC.

---

## 5. Idiomas

- O idioma precisa **existir antes** do import ("Add/remove languages"). Sem o idioma criado,
  não há coluna e o conteúdo não entra.
- **Colunas de idioma localizado importam sim** (provado: SnapAway tem 9 idiomas com
  Description multi-linha e screenshots por URL, tudo importado; e um import só com
  `pt.ShortTitle` foi gravado e apareceu no export seguinte).
- Antes do primeiro import, garanta que o `en-US` existe na lista de idiomas.
- Se o export veio só com `default` (sem coluna de idioma), a listagem ainda está **vazia** —
  é normal no começo.

---

## 6. Método "Import folder"

Alternativa ao CSV "solto": **uma pasta** com o `.csv` + as imagens lado a lado.

- A célula do asset vira o **nome do arquivo** (caminho relativo dentro da pasta).
- Monte a pasta programaticamente e **confira todo caminho relativo** antes de zipar/enviar.
- Há relato de sucesso reaproveitando **a URL inteira do en-us** para o logo em pt (reuso
  aceito, sem precisar de arquivo).

---

## 7. Playbook de bissecção (o que fazer quando o erro é genérico)

1. Parta **sempre do export atual** (nunca de um CSV antigo) e mude **uma coluna só**.
2. Crie uma fila de arquivos incrementais e nomeie claro: `t1` (só Description), `t2`
   (Description + SearchTerms), `t3`… até achar o campo que derruba.
3. Ao achar, reduza ao campo exato e compare com o que **já foi aceito** em outro app
   (ex.: os 118 SearchTerms da SnapAway revelaram a regra das ≤3 palavras).
4. Confirme o resultado sempre pelo **export seguinte**, célula a célula.

---

## 8. Ferramentas de apoio (padrão de projeto)

- `tools/fill-listing-column.mjs` — parse quote-aware, **prova round-trip byte-idêntico antes
  de escrever**, normaliza LF→EOL do arquivo dentro da célula, preenche **uma** coluna e
  confere que **0 células fora dela** mudaram.
- `tools/build-listing-folder.mjs` — roda o preenchimento coluna a coluna e valida todos os
  caminhos relativos da pasta de import.
- `cmp-listing.mjs` — compara template × CSV **célula a célula** e **lista as perdas**
  (detecta o efeito destrutivo do §3).
- Geradores por app (ex.: `fill-sonicaura-listing.mjs`) devem ser **idempotentes**, aceitar o
  caminho do CSV como argumento, preservar BOM + CRLF + `\n\n` internos, validar limites e o
  número de colunas, e **editar a fonte (o gerador), não o CSV**.

---

## 9. Checklist antes de enviar

- [ ] Parti do **export mais recente** do Partner Center.
- [ ] O idioma de destino **existe** em "Add/remove languages".
- [ ] Header intacto (mesmas colunas e ordem); nenhum `Field`/`ID` alterado.
- [ ] BOM UTF-8 preservado; células com vírgula/multi-linha devidamente quoted.
- [ ] O CSV está **completo para cada idioma que ele toca** (senão apaga o resto).
- [ ] SearchTerms: ≤ 7, **≤ 3 palavras** cada, sem marca de terceiro.
- [ ] Description ≤ 10.000, sem URL/HTML.
- [ ] What's new vazio (primeira submissão).
- [ ] Assets: URL inteira de **um único** idioma (não híbrida) ou nome de arquivo na pasta.
- [ ] `cmp-listing` → **0 perdas** de células.
