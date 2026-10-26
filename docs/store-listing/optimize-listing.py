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
  7. hi               -> preenche o idioma hindi inteiro (o Partner Center cria a coluna
                          vazia ao adicionar o idioma; o Title fica "SnapAway" porque o
                          nome reservado em hindi ainda nao tem traducao)

Uso:
    python docs/store-listing/optimize-listing.py <caminho-do-csv-original>
"""

import csv
import io
import re
import sys
from pathlib import Path

LANGS = ["en-us", "pt", "ar", "de", "es", "fr", "ja", "ko", "zh-cn", "hi"]
MAX_SEARCH_TERM = 30
MAX_CAPTION = 200
MAX_RELEASE_NOTES = 1500

# Prefixo de listing usado nas URLs de midia copiadas para o hindi. Vazio = usar o
# prefixo do en-us (as imagens sao ativos compartilhados, o mesmo listingassets/<id>
# aparece em todos os idiomas). Troque pelo ID do listing hindi se a importacao
# recusar o prefixo emprestado com "The value you provided is not valid".
HI_LISTING_ID = ""

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
    "hi": "मुफ़्त: 2 ऐप्स तक छुपाएं · Pro Lifetime: असीमित ऐप्स · "
          "एक बार की खरीद, कोई सदस्यता नहीं",
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
    "hi": ["ऐप छुपाने वाला ऐप", "विंडो छुपाएं शॉर्टकट", "बॉस की विंडो",
           "टास्कबार छुपाएं", "प्राइवेसी स्क्रीन", "boss key windows",
           "chhupane wala app"],
}

# Idioma hindi: a coluna nasce vazia quando o idioma e adicionado no Partner Center.
# Os links do edenware.app para /snapaway/hi/ ainda nao existem (404), entao o EULA
# aponta para a versao em ingles. Features 1..9 ficam aqui; Feature10 e SearchTerm1..7
# vem de FEATURE10/SEARCH_TERMS, que ja rodam para todos os idiomas de LANGS.
HINDI = {
    "Title": "SnapAway",
    "ShortTitle": "SnapAway",
    "VoiceTitle": "SnapAway",
    "DevStudio": "Edenware — https://edenware.app",
    "CopyrightTrademarkInformation":
        "© 2026 Edenware. SnapAway, Edenware का ट्रेडमार्क है। सर्वाधिकार सुरक्षित।",
    "AdditionalLicenseTerms":
        "इस उत्पाद को इंस्टॉल या उपयोग करके आप Edenware की सेवा शर्तों और EULA से सहमत होते हैं। "
        "विवरण: https://edenware.app/snapaway/en/",
    "ShortDescription":
        "निजी ऐप्स खुले रह जाने पर कभी पकड़े न जाएं। एक शॉर्टकट से ऐप्स स्क्रीन, टास्कबार और "
        "Alt+Tab से तुरंत गायब — कुछ बंद किए बिना, बिना तनाव।",
    # As notas de versao sairam daqui: agora ficam em RELEASE_NOTES, unica fonte
    # para os 10 idiomas (inclusive o hindi). Ver o passo 9 em main().
    "Description": """निजी ऐप्स खुले रह जाने पर कभी पकड़े न जाएं।

SnapAway आपको Windows पर एक ही शॉर्टकट से ऐप्स तुरंत छुपाने देता है। जैसे ही कोई कमरे में आता है, चुने हुए सभी ऐप्स डेस्कटॉप, टास्कबार और Alt+Tab से गायब हो जाते हैं — और सुरक्षित होते ही उतनी ही तेज़ी से वापस आ जाते हैं।

मुफ़्त संस्करण में एक बार में 2 ऐप्स तक छुपाए जा सकते हैं।
असीमित ऐप्स और उन्नत सुविधाओं के लिए Pro Lifetime में अपग्रेड करें। कोई सदस्यता नहीं।

प्रोग्राम बंद करने या अपना काम खोने की ज़रूरत नहीं। SnapAway सब कुछ सुरक्षित रूप से बैकग्राउंड में चलाता रहता है, ताकि नियंत्रण हमेशा आपके पास रहे।

चुने हुए ऐप्स तुरंत छुपाने के लिए F6 दबाएं। उन्हें फिर दिखाने के लिए Ctrl+F6 दबाएं।

उन पलों के लिए बिल्कुल सही जब निजता ज़रूरी हो: काम, पढ़ाई, वीडियो देखना या अजीब स्थितियों से बचना।

पलक झपकते ही ध्यान भटकाने वाली चीज़ें गायब।
शांत रहें। निजी रहें। नियंत्रण में रहें — तुरंत।

एक बार की खरीद। कोई सदस्यता नहीं।""",
    "DesktopScreenshotCaption1": "एक ही कुंजी से अपने सभी ऐप्स तुरंत छुपाएं",
    "Feature1": "इंस्टेंट हाइड शॉर्टकट: एक कुंजी दबाकर चुने हुए सभी ऐप्स छुपाएं",
    "Feature2": "बंद करने की ज़रूरत नहीं: ऐप्स सुरक्षित रूप से बैकग्राउंड में चलते रहते हैं",
    "Feature3": "पूरी तरह अदृश्य: ऐप्स डेस्कटॉप, टास्कबार और Alt+Tab से हट जाते हैं",
    "Feature4": "तेज़ रिस्टोर: सब कुछ तुरंत वापस",
    "Feature5": "पासवर्ड सुरक्षा: अनधिकृत पहुंच रोकें",
    "Feature6": "साइलेंट मोड: ऐप्स छुपे होने पर ऑडियो म्यूट करें",
    "Feature7": "ऑटो-स्टार्ट: जब ज़रूरत हो, हमेशा तैयार",
    "Feature8": "हल्का: तेज़ और कम संसाधन उपयोग",
    "Feature9": "F6 से ऐप्स छुपाएं; Ctrl+F6 से सब कुछ वापस लाएं",
}

TITLE_FIX = {"ja": "SnapAway"}

# Legendas dos screenshots 2..5.
#
# O export traz uma ORDEM diferente por idioma: as seis permutacoes de "botao
# flutuante", "temas" e "personalizar" aparecem (pt = temas/customizar/flutuante,
# ar e de = customizar/flutuante/temas, es = customizar/temas/flutuante, fr =
# flutuante/customizar/temas, ko = temas/flutuante/customizar). Como os cinco
# screenshots sao os mesmos arquivos em todos os idiomas, as legendas 2..4 sao
# reescritas na ordem do `en-us`: 2 = botao flutuante, 3 = temas, 4 = personalizar.
#
# A legenda 5 estava corrompida no export em 8 idiomas: o texto foi quebrado na
# virgula e vazou uma coluna para a direita (o pt terminava no ar, o ar no de, o
# de no es, o es no ja, o fr no zh-cn) e o final de cada um se perdeu. Reescrita
# aqui, e de proposito SEM virgulas, para nao repetir o problema em editores que
# tratam virgula como separador de campo.
CAPTION_FLOATING = {
    "en-us": "Discreet floating button in the lower right corner (optional) — always within reach",
    "pt": "Botão flutuante discreto no canto inferior direito (opcional) — sempre ao alcance",
    "ar": "زر عائم غير ملحوظ في الزاوية السفلية اليمنى (اختياري) — دائمًا في متناول يدك",
    "de": "Unauffälliger schwebender Button in der unteren rechten Ecke (optional) — immer griffbereit",
    "es": "Botón flotante discreto en la esquina inferior derecha (opcional) — siempre a mano",
    "fr": "Bouton flottant discret dans le coin inférieur droit (facultatif) — toujours à portée de main",
    "ja": "右下の目立たないフローティングボタン（オプション）— いつでも手の届く場所に",
    "ko": "오른쪽 아래 구석의 눈에 띄지 않는 플로팅 버튼(선택 사항) — 언제든 손이 닿는 곳에",
    "zh-cn": "右下角的隐蔽悬浮按钮（可选）— 随时触手可及",
    "hi": "निचले दाएं कोने में डिस्क्रीट फ्लोटिंग बटन (वैकल्पिक) — हमेशा पहुंच में",
}

CAPTION_THEMES = {
    "en-us": "Light and dark themes",
    "pt": "Temas claro e escuro",
    "ar": "سمات فاتحة وداكنة",
    "de": "Helle und dunkle Designs",
    "es": "Temas claro y oscuro",
    "fr": "Thèmes clair et sombre",
    "ja": "ライト/ダークテーマ",
    "ko": "라이트/다크 테마",
    "zh-cn": "浅色和深色主题",
    "hi": "लाइट और डार्क थीम",
}

CAPTION_CUSTOMIZE = {
    "en-us": "Customize your shortcut and privacy settings",
    "pt": "Personalize seu atalho e suas configurações de privacidade",
    "ar": "خصص اختصارك وإعدادات الخصوصية",
    "de": "Passe deinen Shortcut und deine Datenschutzeinstellungen an",
    "es": "Personaliza tu atajo y tu configuración de privacidad",
    "fr": "Personnalisez votre raccourci et vos paramètres de confidentialité",
    "ja": "ショートカットとプライバシー設定を自由にカスタマイズ",
    "ko": "단축키와 개인정보 설정을 자유롭게 맞춤 설정",
    "zh-cn": "自由自定义快捷键和隐私设置",
    "hi": "अपना शॉर्टकट और प्राइवेसी सेटिंग्स बदलें",
}

CAPTION_RESTORE = {
    "en-us": "Use Ctrl+F6 to restore your windows — behavior is highly configurable",
    "pt": "Use Ctrl+F6 para restaurar suas janelas — comportamento altamente configurável",
    "ar": "استخدم Ctrl+F6 لاستعادة نوافذك — مع سلوك قابل للتخصيص بدرجة كبيرة",
    "de": "Verwende Ctrl+F6 um deine Fenster wiederherzustellen — hochgradig konfigurierbares Verhalten",
    "es": "Usa Ctrl+F6 para restaurar tus ventanas — comportamiento altamente configurable",
    "fr": "Utilisez Ctrl+F6 pour restaurer vos fenêtres — comportement hautement configurable",
    "ja": "Ctrl+F6 でウィンドウを復元 — 動作は高度にカスタマイズ可能",
    "ko": "Ctrl+F6으로 창 복원 — 동작을 자유롭게 설정 가능",
    "zh-cn": "使用 Ctrl+F6 恢复窗口 — 行为高度可配置",
    "hi": "विंडो वापस लाने के लिए Ctrl+F6 — व्यवहार पूरी तरह अनुकूलन योग्य",
}


# Notas da versao 1.2.5 (`ReleaseNotes`). Substituem integralmente o texto de
# 1.2.4 que vem no export — notas antigas descrevem correcoes que o usuario desta
# versao ja tem, e a Store mostra apenas as notas da versao publicada.
RELEASE_NOTES = {
    "en-us": """• New guided tour: you pick the window to hide and learn both shortcuts by pressing the real keys — the tour only advances after the correct key
• Clear notice when no target window is selected, instead of hiding nothing
• 18 missing texts are now translated in all 19 languages""",
    "pt": """• Novo tour guiado: você escolhe a janela a ocultar e aprende os dois atalhos apertando as teclas de verdade — o tour só avança com a tecla certa
• Aviso claro quando nenhuma janela-alvo está selecionada, em vez de não ocultar nada
• 18 textos que faltavam agora estão traduzidos nos 19 idiomas""",
    "ar": """• جولة إرشادية جديدة: تختار النافذة المراد إخفاؤها وتتعلم الاختصارين بالضغط على المفاتيح فعليًا — لا تتقدم الجولة إلا بالمفتاح الصحيح
• تنبيه واضح عند عدم تحديد نافذة هدف بدلًا من عدم إخفاء أي شيء
• ترجمة 18 نصًا كان ناقصًا في جميع اللغات الـ19""",
    "de": """• Neue geführte Tour: du wählst das Fenster zum Verstecken und lernst beide Tastenkombinationen durch echtes Drücken — weiter geht es erst mit der richtigen Taste
• Klarer Hinweis, wenn kein Zielfenster ausgewählt ist, statt nichts zu verstecken
• 18 fehlende Texte sind jetzt in allen 19 Sprachen übersetzt""",
    "es": """• Nuevo recorrido guiado: eliges la ventana que quieres ocultar y aprendes los dos atajos pulsando las teclas de verdad — solo avanza con la tecla correcta
• Aviso claro cuando no hay ninguna ventana objetivo seleccionada, en lugar de no ocultar nada
• 18 textos que faltaban ya están traducidos en los 19 idiomas""",
    "fr": """• Nouveau tutoriel guidé : vous choisissez la fenêtre à masquer et apprenez les deux raccourcis en appuyant réellement sur les touches — il n'avance qu'avec la bonne touche
• Avertissement clair lorsqu'aucune fenêtre cible n'est sélectionnée, au lieu de ne rien masquer
• 18 textes manquants sont désormais traduits dans les 19 langues""",
    "ja": """• 新しいガイド付きツアー：隠すウィンドウを選び、実際にキーを押して 2 つのショートカットを覚えます — 正しいキーを押すまで先に進みません
• 対象ウィンドウが未選択のときは、何も隠さずに終わる代わりに分かりやすい通知を表示
• 不足していた 18 個のテキストを 19 言語すべてに翻訳しました""",
    "ko": """• 새 단계별 안내: 숨길 창을 고르고 실제 키를 눌러 두 단축키를 익힙니다 — 올바른 키를 눌러야 다음으로 진행됩니다
• 대상 창이 선택되지 않았을 때 아무것도 숨기지 않고 끝나는 대신 명확한 안내를 표시
• 빠져 있던 18개 문구를 19개 언어 모두에 번역했습니다""",
    "zh-cn": """• 新增引导教程：选择要隐藏的窗口，并通过实际按键学习两个快捷键 — 只有按对键才会继续
• 未选择目标窗口时会显示明确提示，而不是什么都不隐藏
• 补齐了 19 种语言中缺失的 18 条文本""",
    "hi": """• नया गाइडेड टूर: आप छिपाने के लिए विंडो चुनते हैं और असली कुंजियाँ दबाकर दोनों शॉर्टकट सीखते हैं — सही कुंजी दबाने पर ही टूर आगे बढ़ता है
• कोई टारगेट विंडो चुनी हुई न होने पर कुछ न छिपाने के बजाय साफ़ सूचना दिखती है
• छूटे हुए 18 टेक्स्ट अब सभी 19 भाषाओं में अनुवादित हैं""",
}


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

    # 7. idioma hindi (so existe no export depois de o idioma ser adicionado na Store)
    if "hi" in fieldnames:
        for name, value in HINDI.items():
            row = by_field.get(name)
            if row is None:
                continue
            value = value.strip()
            if (row.get("hi") or "").strip() != value:
                changes.append((f"{name}[hi]", (row.get("hi") or "").strip(), value))
                row["hi"] = value

    # 8. legendas dos screenshots 2..5 (ordem por idioma + legenda 5 corrompida no export)
    for lang in LANGS:
        if lang not in CAPTION_THEMES:
            continue
        for name, value in (
            ("DesktopScreenshotCaption2", CAPTION_FLOATING[lang]),
            ("DesktopScreenshotCaption3", CAPTION_THEMES[lang]),
            ("DesktopScreenshotCaption4", CAPTION_CUSTOMIZE[lang]),
            ("DesktopScreenshotCaption5", CAPTION_RESTORE[lang]),
        ):
            assert len(value) <= MAX_CAPTION, f"{name}[{lang}]: {len(value)}"
            row = by_field[name]
            if (row.get(lang) or "").strip() != value:
                changes.append((f"{name}[{lang}]", (row.get(lang) or "").strip(), value))
                row[lang] = value

    # 9. notas da versao 1.2.5
    for lang in LANGS:
        value = RELEASE_NOTES[lang].strip()
        assert len(value) <= MAX_RELEASE_NOTES, f"ReleaseNotes[{lang}]: {len(value)}"
        row = by_field["ReleaseNotes"]
        if (row.get(lang) or "").strip() != value:
            changes.append((f"ReleaseNotes[{lang}]", (row.get(lang) or "").strip(), value))
            row[lang] = value

    # 10. midias dos screenshots no hindi
    # A coluna hi do export vem sem nenhuma linha de midia, embora as imagens sejam
    # as mesmas dos outros idiomas. Copiamos as URLs do en-us, que e a ordem
    # canonica (a mesma usada nas legendas do passo 8).
    if "hi" in fieldnames:
        for i in range(1, 6):
            row = by_field[f"DesktopScreenshot{i}"]
            source = (row.get("en-us") or "").strip()
            if not source:
                continue
            value = source
            if HI_LISTING_ID:
                value = re.sub(r"/listings/\d+/", f"/listings/{HI_LISTING_ID}/", source)
            if (row.get("hi") or "").strip() != value:
                changes.append((f"DesktopScreenshot{i}[hi]", (row.get("hi") or "").strip(), value))
                row["hi"] = value

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
