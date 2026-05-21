import pathlib
path = pathlib.Path('src/language/texts.json')
text = path.read_text(encoding='utf-8')
updates = {
    '"RECORDING": "Set your VanishKey..."': '"RECORDING": "Set your VanishKey..."',
    '"RECORDING": "جارٍ التسجيل..."': '"RECORDING": "عيّن VanishKey الخاص بك..."',
    '"RECORDING": "Nahrávání..."': '"RECORDING": "Nastavte svůj VanishKey..."',
    '"RECORDING": "Aufnahme..."': '"RECORDING": "Stellen Sie Ihre VanishKey ein..."',
    '"RECORDING": "Εγγραφή..."': '"RECORDING": "Ορίστε το VanishKey σας..."',
    '"RECORDING": "Grabando..."': '"RECORDING": "Establece tu VanishKey..."',
    '"RECORDING": "Enregistrement..."': '"RECORDING": "Définissez votre VanishKey..."',
    '"RECORDING": "रिकॉर्डिंग..."': '"RECORDING": "अपना VanishKey सेट करें..."',
    '"RECORDING": "Felvétel..."': '"RECORDING": "Állítsa be a VanishKey-jét..."',
    '"RECORDING": "Registrazione..."': '"RECORDING": "Imposta la tua VanishKey..."',
    '"RECORDING": "記録中..."': '"RECORDING": "VanishKeyを設定してください..."',
    '"RECORDING": "녹화 중..."': '"RECORDING": "VanishKey를 설정하세요..."',
    '"RECORDING": "Opnemen..."': '"RECORDING": "Stel je VanishKey in..."',
    '"RECORDING": "Nagrywanie..."': '"RECORDING": "Ustaw swój VanishKey..."',
    '"RECORDING": "Gravando..."': '"RECORDING": "Defina sua VanishKey..."',
    '"RECORDING": "Запись..."': '"RECORDING": "Установите свой VanishKey..."',
    '"RECORDING": "Spelar in..."': '"RECORDING": "Ange din VanishKey..."',
    '"RECORDING": "กำลังบันทึก..."': '"RECORDING": "ตั้งค่า VanishKey ของคุณ..."',
    '"RECORDING": "Kayıt ediliyor..."': '"RECORDING": "VanishKey\'inizi ayarlayın..."',
    '"RECORDING": "正在记录..."': '"RECORDING": "设置您的VanishKey..."',
}
for old, new in updates.items():
    if old not in text:
        raise SystemExit(f"Missing key to replace: {old}")
    text = text.replace(old, new)
path.write_text(text, encoding='utf-8')
print('done')
