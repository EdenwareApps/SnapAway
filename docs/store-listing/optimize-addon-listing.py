"""Gera uma copia otimizada do CSV de listagem do add-on SnapAwayPro.

Entrada : listingData-9NNLVZPCLLTZ-<submission>.csv  (exportado do Partner Center)
Saida   : addonListingData-optimized.csv

O add-on tem so tres campos (Title, Description, StoreLogo300x300), mas cada
idioma novo nasce vazio: o Partner Center cria a coluna quando o idioma e
adicionado e nao herda nada do idioma base. Consequencia pratica: o paywall do
app le o titulo/descricao da Store no locale do usuario, entao um idioma vazio
mostra o card Pro em ingles no meio de uma interface traduzida.

Mudancas aplicadas:
  1. Title / Description -> preenche os 9 idiomas nao-base (hi, pt, ar, zh, fr,
                            de, ja, ko, es); o es/en-us tambem recebem o texto
                            revisado
  2. en-us               -> corrige "future Snapcover improvements" (nome do
                            repositorio, nao do produto) e troca "unlimited Pro
                            features" pela lista real de recursos Pro
  3. StoreLogo300x300    -> replica a URL do en-us em todos os idiomas; a imagem
                            e um ativo compartilhado, nao um upload por idioma
                            (mesmo mecanismo aceito na listagem do app)

O prefixo da URL de midia (submission/listings/listingassets) muda a cada
submissao, por isso ele nunca e fixado aqui: e lido da propria celula do en-us.

Uso:
    python docs/store-listing/optimize-addon-listing.py <caminho-do-csv-original>
"""

import csv
import io
import sys
from pathlib import Path

# O add-on usa `zh` (nao `zh-cn`) porque a coluna foi criada pelo Partner Center.
LANGS = ["en-us", "hi", "pt", "ar", "zh", "fr", "de", "ja", "ko", "es"]

LOGO_FIELD = "StoreLogo300x300"
MAX_TITLE = 200
# O Partner Center recusa Description acima de 200 caracteres, mas a mensagem de
# erro diz "must be 10000 characters or fewer" — o numero do texto nao e o limite
# real do campo. Medido em 26/10/2026: as 6 descricoes acima de 200 foram
# rejeitadas e as 4 abaixo (74..174) passaram.
MAX_DESCRIPTION = 200

# ---------------------------------------------------------------- conteudo novo

TITLES = {
    "en-us": "SnapAway Pro Lifetime",
    "pt": "SnapAway Pro Vitalício",
    "hi": "SnapAway Pro — लाइफ़टाइम अनलॉक",
    "es": "SnapAway Pro de por vida",
    "de": "SnapAway Pro — Lebenslang",
    "fr": "SnapAway Pro à vie",
    "ja": "SnapAway Pro（買い切り）",
    "ko": "SnapAway Pro 평생 이용권",
    "zh": "SnapAway Pro 永久版",
    "ar": "SnapAway Pro — ترخيص دائم",
}

# "snapcover" com cedilha/hifen e o nome do repositorio, nao do produto: a
# descricao antiga prometia "future Snapcover improvements" ao comprador.
DESCRIPTIONS = {
    "en-us": (
        "Unlock every SnapAway privacy tool with one payment: unlimited apps, "
        "password protection, auto audio mute, advanced cloaking and all future "
        "Pro updates. No subscription."
    ),
    "pt": (
        "Libere todas as ferramentas de privacidade do SnapAway com um único "
        "pagamento: apps ilimitados, senha, mute automático, camuflagem avançada "
        "e todas as atualizações Pro. Sem assinatura."
    ),
    "hi": (
        "एक ही भुगतान में SnapAway के सभी प्राइवेसी टूल अनलॉक करें: असीमित ऐप्स, "
        "पासवर्ड सुरक्षा, ऑटो ऑडियो म्यूट, उन्नत क्लोकिंग और सभी आने वाले Pro अपडेट। "
        "कोई सब्सक्रिप्शन नहीं।"
    ),
    "es": (
        "Desbloquea todos los recursos de SnapAway con un solo pago: apps "
        "ilimitadas, contraseña, silencio automático del audio, camuflaje avanzado "
        "y todas las actualizaciones Pro. Sin suscripción."
    ),
    "de": (
        "Alle Datenschutz-Werkzeuge von SnapAway mit einer Zahlung: unbegrenzte "
        "Apps, Passwortschutz, automatische Audio-Stummschaltung, erweitertes "
        "Tarnen und alle künftigen Pro-Updates. Kein Abo."
    ),
    "fr": (
        "Débloquez tous les outils de SnapAway en un seul paiement : applications "
        "illimitées, mot de passe, coupure audio automatique, camouflage avancé et "
        "toutes les mises à jour Pro. Sans abonnement."
    ),
    "ja": (
        "SnapAway のプライバシーツールをすべて解放します。買い切り：アプリ数の制限解除、"
        "パスワード保護、音声の自動ミュート、高度なカモフラージュ、今後の Pro アップデート"
        "すべて込み。サブスクリプションや継続課金はありません。"
    ),
    "ko": (
        "SnapAway의 모든 프라이버시 도구를 사용하세요. 1회 결제: 앱 개수 제한 해제, "
        "비밀번호 보호, 자동 오디오 음소거, 고급 위장 기능, 향후 모든 Pro 업데이트 포함. "
        "구독이나 반복 결제가 없습니다."
    ),
    "zh": (
        "解锁 SnapAway 的全部隐私工具。一次购买：应用数量不限、密码保护、自动静音、"
        "高级伪装，并包含后续所有 Pro 更新——无需订阅，无重复收费。"
    ),
    "ar": (
        "افتح جميع أدوات الخصوصية في SnapAway دفعة واحدة: تطبيقات بلا حدود، حماية "
        "بكلمة مرور، كتم تلقائي للصوت، إخفاء متقدم وكل تحديثات Pro. بدون اشتراك."
    ),
}


def same(current, expected):
    return (current or "").replace("\r\n", "\n").strip() == expected.strip()


def main():
    if len(sys.argv) < 2:
        sys.exit("uso: python optimize-addon-listing.py <csv-original>")

    src = Path(sys.argv[1])
    if not src.is_file():
        sys.exit(f"arquivo nao encontrado: {src}")

    with src.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames
        rows = list(reader)

    missing = [l for l in LANGS if l not in fieldnames]
    if missing:
        sys.exit(f"idiomas ausentes no export: {missing}")
    extra = [f for f in fieldnames[4:] if f not in LANGS]
    if extra:
        sys.exit(f"idiomas no export sem texto definido: {extra}")

    for lang in LANGS:
        assert len(TITLES[lang]) <= MAX_TITLE, lang
        assert len(DESCRIPTIONS[lang]) <= MAX_DESCRIPTION, f"{lang}: {len(DESCRIPTIONS[lang])}"

    changes = []
    by_field = {row["Field"]: row for row in rows if (row.get("Field") or "").strip()}

    for name, texts in (("Title", TITLES), ("Description", DESCRIPTIONS)):
        row = by_field[name]
        for lang in LANGS:
            if same(row.get(lang), texts[lang]):
                continue
            changes.append((f"{name}[{lang}]", row.get(lang) or "", texts[lang]))
            row[lang] = texts[lang]

    # 3. logo compartilhado
    row = by_field[LOGO_FIELD]
    logo = (row.get("en-us") or "").strip()
    if not logo:
        sys.exit("StoreLogo300x300 vazio no en-us: envie o logo antes de exportar")
    for lang in LANGS[1:]:
        if (row.get(lang) or "").strip() == logo:
            continue
        changes.append((f"{LOGO_FIELD}[{lang}]", row.get(lang) or "", logo))
        row[lang] = logo

    for row in rows:
        for key in list(row):
            if row[key] is None:
                row[key] = ""

    out = Path(__file__).resolve().parent / "addonListingData-optimized.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames,
                                quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)

    print(f"gerado: {out}  ({out.stat().st_size} bytes, {len(rows)} linhas)")
    print(f"alteracoes: {len(changes)}\n")
    for field, old, new in changes:
        print(f"  {field}\n      de: {old[:70]}\n      p/ : {new[:70]}")


if __name__ == "__main__":
    stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stdout = stdout
    main()
