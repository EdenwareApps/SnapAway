const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'src', 'language', 'texts.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const english = {
  WELCOME_TO_SNAPAWAY: 'Welcome to SnapAway',
  ONBOARDING_STEP_1: 'This app hides windows based on filter rules and restores them safely.',
  ONBOARDING_STEP_2: 'Step 1: Select a window and add it to the list.',
  ONBOARDING_STEP_3: 'Step 2: Click Protect or press VanishKey to hide selected windows.',
  ONBOARDING_STEP_4: 'Step 3: Restore with the same button or Show shortcut.',
  GOT_IT: 'Got it'
};
const translations = {
  ar: {
    WELCOME_TO_SNAPAWAY: 'مرحبًا بك في SnapAway',
    ONBOARDING_STEP_1: 'يُخفي هذا التطبيق النوافذ بناءً على قواعد الفلاتر ويستعيدها بأمان.',
    ONBOARDING_STEP_2: 'الخطوة 1: اختر نافذة وأضفها إلى القائمة.',
    ONBOARDING_STEP_3: 'الخطوة 2: انقر على حماية أو اضغط VanishKey لإخفاء النوافذ المحددة.',
    ONBOARDING_STEP_4: 'الخطوة 3: استعد بنفس الزر أو اختصار العرض.',
    GOT_IT: 'حسناً'
  },
  cs: {
    WELCOME_TO_SNAPAWAY: 'Vítejte v SnapAwayu',
    ONBOARDING_STEP_1: 'Tato aplikace skrývá okna na základě pravidel filtrů a bezpečně je obnovuje.',
    ONBOARDING_STEP_2: 'Krok 1: Vyberte okno a přidejte ho do seznamu.',
    ONBOARDING_STEP_3: 'Krok 2: Klikněte na Chránit nebo stiskněte VanishKey pro skrytí vybraných oken.',
    ONBOARDING_STEP_4: 'Krok 3: Obnovte pomocí stejného tlačítka nebo zkratky Zobrazit.',
    GOT_IT: 'Hotovo'
  },
  de: {
    WELCOME_TO_SNAPAWAY: 'Willkommen bei SnapAway',
    ONBOARDING_STEP_1: 'Diese App versteckt Fenster basierend auf Filterregeln und stellt sie sicher wieder her.',
    ONBOARDING_STEP_2: 'Schritt 1: Wählen Sie ein Fenster aus und fügen Sie es der Liste hinzu.',
    ONBOARDING_STEP_3: 'Schritt 2: Klicken Sie auf Schützen oder drücken Sie VanishKey, um ausgewählte Fenster zu verstecken.',
    ONBOARDING_STEP_4: 'Schritt 3: Wiederherstellen mit derselben Schaltfläche oder der "Zeigen"-Verknüpfung.',
    GOT_IT: 'Verstanden'
  },
  es: {
    WELCOME_TO_SNAPAWAY: 'Bienvenido a SnapAway',
    ONBOARDING_STEP_1: 'Esta app oculta ventanas según reglas de filtro y las restaura de forma segura.',
    ONBOARDING_STEP_2: 'Paso 1: Selecciona una ventana y agrégala a la lista.',
    ONBOARDING_STEP_3: 'Paso 2: Haz clic en Proteger o presiona VanishKey para ocultar las ventanas seleccionadas.',
    ONBOARDING_STEP_4: 'Paso 3: Restaura con el mismo botón o atajo Mostrar.',
    GOT_IT: 'Entendido'
  },
  fr: {
    WELCOME_TO_SNAPAWAY: 'Bienvenue sur SnapAway',
    ONBOARDING_STEP_1: 'Cette application cache les fenêtres selon des règles de filtre et les restaure en toute sécurité.',
    ONBOARDING_STEP_2: 'Étape 1 : Sélectionnez une fenêtre et ajoutez-la à la liste.',
    ONBOARDING_STEP_3: 'Étape 2 : Cliquez sur Protéger ou appuyez sur VanishKey pour cacher les fenêtres sélectionnées.',
    ONBOARDING_STEP_4: 'Étape 3 : Restaurez avec le même bouton ou le raccourci Afficher.',
    GOT_IT: 'Compris'
  },
  pt: {
    WELCOME_TO_SNAPAWAY: 'Bem-vindo ao SnapAway',
    ONBOARDING_STEP_1: 'Este app oculta janelas com base em regras de filtro e as restaura com segurança.',
    ONBOARDING_STEP_2: 'Passo 1: Selecione uma janela e adicione à lista.',
    ONBOARDING_STEP_3: 'Passo 2: Clique em Proteger ou pressione VanishKey para ocultar as janelas selecionadas.',
    ONBOARDING_STEP_4: 'Passo 3: Restaure com o mesmo botão ou atalho Mostrar.',
    GOT_IT: 'Entendi'
  }
};
Object.keys(data).forEach(lang => {
  const source = translations[lang] || english;
  Object.keys(source).forEach(key => {
    data[lang][key] = source[key];
  });
});
fs.writeFileSync(file, JSON.stringify(data, null, 2,), 'utf8');
console.log('ok');
