"""Gera uma copia otimizada do CSV de listagem da Microsoft Store do SnapAway.

Entrada : listingData-<ID>-<submission>.csv  (exportado do Partner Center)
Saida   : listingData-optimized.csv

Mudancas aplicadas (ver docs/STORE_ANALYTICS.md, secao 6):
  1. Description      -> insere o paragrafo do atalho F6/Ctrl+F6 nos 8 idiomas que nao o tem
  2. Description      -> move o bloco comercial (gratis/Pro + compra unica) para a 2a posicao
  3. SearchTerm1..7   -> remove duplicatas e cobre familias de intencao ausentes
  4. Feature10        -> corrige "Free to try" (nao e trial, e versao gratuita limitada)
  5. TrailerToPlayAtTop -> limpa: o trailer do Partner Center e por submissao, entao a URL
                          exportada deixa de existir na submissao seguinte e a importacao
                          falha com "The value you provided is not valid"
  6. Title (ja)       -> precisa ser um nome de produto reservado; o sufixo em japones
                          e rejeitado com "must be one of your reserved product names"

Uso:
    python docs/store-listing/optimize-listing.py <caminho-do-csv-original>
"""

import csv
import io
import re
import sys
from pathlib import Path

LANGS = ["en-us", "pt", "ar", "de", "es", "fr", "ja", "ko", "zh-cn"]
MAX_SEARCH_TERM = 30

# ---------------------------------------------------------------- conteudo novo

SHORTCUT_PARAGRAPH = {
    "pt": "Pressione F6 para ocultar na hora os apps selecionados. "
          "Pressione Ctrl+F6 para mostrá-los novamente.",
    "ar": "اضغط F6 لإخفاء التطبيقات المحددة على الفور. اضغط Ctrl+F6 لإظهارها مرة أخرى.",
    "de": "Drücke F6, um die ausgewählten Apps sofort auszublenden. "
          "Mit Ctrl+F6 holst du sie wieder zurück.",
    "es": "Pulsa F6 para ocultar al instante las apps seleccionadas. "
          "Pulsa Ctrl+F6 para mostrarlas de nuevo.",
    "fr": "Appuyez sur F6 pour masquer instantanément les apps sélectionnées. "
          "Appuyez sur Ctrl+F6 pour les faire réapparaître.",
    "ja": "F6 キーを押すと選択したアプリが瞬時に非表示になります。"
          "Ctrl+F6 キーで元に戻ります。",
    "ko": "F6 키를 누르면 선택한 앱이 즉시 숨겨집니다. "
          "Ctrl+F6 키를 누르면 다시 나타납니다.",
    "zh-cn": "按 F6 键即可即时隐藏所选应用，按 Ctrl+F6 键即可恢复显示。",
}

FEATURE10 = {
    "en-us": "Free: hide up to 2 apps · Pro Lifetime: unlimited apps · "
             "one-time purchase, no subscription",
    "pt": "Grátis: oculte até 2 apps · Pro Lifetime: apps ilimitados · "
          "compra única, sem assinatura",
    "ar": "مجاني: إخفاء حتى تطبيقين · Pro Lifetime: تطبيقات غير محدودة · "
          "شراء لمرة واحدة، بدون اشتراك",
    "de": "Kostenlos: bis zu 2 Apps ausblenden · Pro Lifetime: unbegrenzte Apps · "
          "einmaliger Kauf, kein Abonnement",
    "es": "Gratis: oculta hasta 2 apps · Pro Lifetime: apps ilimitadas · "
          "compra única, sin suscripción",
    "fr": "Gratuit : masquez jusqu'à 2 apps · Pro Lifetime : apps illimitées · "
          "achat unique, sans abonnement",
    "ja": "無料：2つのアプリまで非表示 · Pro Lifetime：アプリ無制限 · "
          "買い切り、サブスクリプションなし",
    "ko": "무료: 앱 2개까지 숨기기 · Pro Lifetime: 앱 무제한 · "
          "일회성 구매, 구독 없음",
    "zh-cn": "免费版：最多隐藏 2 个应用 · Pro Lifetime：应用无限制 · "
             "一次性购买，无订阅",
}

SEARCH_TERMS = {
    "en-us": ["hide apps", "boss key", "hide windows", "window hider",
              "panic button", "privacy screen", "hide taskbar"],
    "pt": ["ocultar apps windows", "ocultar janelas", "atalho ocultar janelas",
           "boss key windows", "tecla do chefe", "botão do pânico",
           "ocultar barra de tarefas"],
    "ar": ["إخفاء التطبيقات ويندوز", "إخفاء النوافذ", "اختصار إخفاء النوافذ",
           "Boss Key ويندوز", "زر الذعر", "شاشة الخصوصية", "إخفاء شريط المهام"],
    "de": ["apps ausblenden windows", "programme ausblenden windows",
           "fenster ausblenden", "boss key windows", "chef taste",
           "panik taste", "taskleiste ausblenden"],
    "es": ["ocultar apps windows", "ocultar ventanas", "ocultar ventanas atajo",
           "boss key windows", "tecla del jefe", "botón de pánico",
           "ocultar barra de tareas"],
    "fr": ["masquer apps windows", "masquer fenêtres",
           "raccourci masquer fenêtres", "boss key windows", "touche patron",
           "bouton panique", "masquer barre des tâches"],
    "ja": ["アプリ 非表示 windows", "ウィンドウ 非表示 ショートカット",
           "ボスキー windows", "アプリ 即 非表示", "パニックボタン",
           "タスクバー 非表示", "画面 隠す"],
    "ko": ["앱 숨기기 윈도우", "창 숨기기 단축키", "보스 키 윈도우",
           "앱 즉시 숨기기", "패닉 버튼", "작업 표시줄 숨기기", "화면 숨기기"],
    "zh-cn": ["隐藏应用 Windows", "隐藏窗口 快捷键", "Boss Key Windows",
              "快速隐藏应用", "老板键", "隐藏任务栏", "老板来了"],
}

TITLE_FIX = {"ja": "SnapAway"}


# ---------------------------------------------------------------- manipulacao

def split_paragraphs(text):
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def join_paragraphs(paragraphs):
    return "\n\n".join(paragraphs)


def is_commercial(paragraph):
    low = paragraph.lower()
    keywords = ("pro lifetime", "assinatura", "abonnement", "suscripción",
                "subscription", "サブスクリプション", "구독", "订阅", "اشتراك",
                "compra única", "achat unique", "einmaliger kauf",
                "一次性购买", "買い切り", "일회성 구매", "شراء لمرة واحدة")
    return any(k in low for k in keywords)


def optimize_description(field, changes):
    for lang in LANGS:
        text = (field.get(lang) or "").strip()
        if not text:
            continue
        paragraphs = split_paragraphs(text)
        original = list(paragraphs)

        # 1. paragrafo do atalho (so nos idiomas que nao citam F6)
        if "F6" not in text and lang in SHORTCUT_PARAGRAPH:
            paragraphs.insert(3 if len(paragraphs) > 3 else len(paragraphs),
                              SHORTCUT_PARAGRAPH[lang])

        # 2. so o paragrafo "gratis / Pro" sobe para a 3a posicao (acima da dobra);
        #    a linha final "compra unica, sem assinatura" continua no rodape.
        commercial = next((p for p in paragraphs if is_commercial(p)), None)
        if commercial is not None:
            rest = [p for p in paragraphs if p != commercial]
            index = min(2, len(rest))
            paragraphs = rest[:index] + [commercial] + rest[index:]

        if paragraphs != original:
            changes.append((f"Description[{lang}]", "paragrafos reordenados/inseridos",
                            f"{len(original)} -> {len(paragraphs)} paragrafos, F6={'sim' if 'F6' in join_paragraphs(paragraphs) else 'nao'}"))
            field[lang] = join_paragraphs(paragraphs)


def main():
    if len(sys.argv) < 2:
        sys.exit("uso: python optimize-listing.py <csv-original>")

    src = Path(sys.argv[1])
    if not src.is_file():
        sys.exit(f"arquivo nao encontrado: {src}")

    with src.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames
        rows = list(reader)

    changes = []
    by_field = {row["Field"]: row for row in rows}

    # 1 + 2. descricao
    optimize_description(by_field["Description"], changes)

    # 3. termos de busca
    for lang in LANGS:
        terms = SEARCH_TERMS[lang]
        assert len(terms) <= 7, lang
        for i, term in enumerate(terms, start=1):
            assert len(term) <= MAX_SEARCH_TERM, f"{lang} termo {i}: {term} ({len(term)})"
            row = by_field[f"SearchTerm{i}"]
            if (row.get(lang) or "").strip() != term:
                changes.append((f"SearchTerm{i}[{lang}]", (row.get(lang) or "").strip(), term))
                row[lang] = term
        for i in range(len(terms) + 1, 8):
            row = by_field[f"SearchTerm{i}"]
            if (row.get(lang) or "").strip():
                changes.append((f"SearchTerm{i}[{lang}]", row[lang], ""))
                row[lang] = ""

    # 4. feature 10
    for lang in LANGS:
        row = by_field["Feature10"]
        if (row.get(lang) or "").strip() != FEATURE10[lang]:
            changes.append((f"Feature10[{lang}]", (row.get(lang) or "").strip(), FEATURE10[lang]))
            row[lang] = FEATURE10[lang]

    # 5. trailer no topo
    # O ID do trailer vale apenas para a submissao em que foi enviado; replicar a
    # URL exportada para outros idiomas faz a importacao falhar com "The value you
    # provided is not valid". Deixamos o campo vazio e o trailer e escolhido na UI.
    row = by_field["TrailerToPlayAtTopOfListing"]
    for lang in LANGS + ["default"]:
        if (row.get(lang) or "").strip():
            changes.append((f"TrailerToPlayAtTopOfListing[{lang}]", (row.get(lang) or "").strip(), ""))
            row[lang] = ""

    # 6. titulo japones
    for lang, title in TITLE_FIX.items():
        row = by_field["Title"]
        changes.append((f"Title[{lang}]", (row.get(lang) or "").strip(), title))
        row[lang] = title

    out = Path(__file__).resolve().parent / "listingData-optimized.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames,
                                quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)

    # O export do Partner Center usa CRLF tambem DENTRO dos campos multilinha.
    data = out.read_bytes().decode("utf-8-sig")
    data = re.sub(r"(?<!\r)\n", "\r\n", data)
    out.write_bytes(b"\xef\xbb\xbf" + data.encode("utf-8"))

    print(f"gerado: {out}  ({out.stat().st_size} bytes, {len(rows)} linhas)")
    print(f"alteracoes: {len(changes)}\n")
    for field, old, new in changes:
        old_s = old.replace("\n", " / ")[:70]
        new_s = new.replace("\n", " / ")[:70]
        print(f"  {field}\n      de: {old_s}\n      p/ : {new_s}")


if __name__ == "__main__":
    stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stdout = stdout
    main()
