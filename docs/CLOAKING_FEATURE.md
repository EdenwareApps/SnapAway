# SnapAway Cloaking Feature — Bot Training Document

> Use este documento para treinar chatbots e sistemas de suporte sobre o recurso Cloaking do SnapAway.

---

## Visão Geral

**Cloaking** (mascaramento/camuflagem) é um recurso premium do SnapAway que permite ocultar a identidade visual do aplicativo no sistema, substituindo nome e ícone por outros personalizados.

- **Nome original:** Cloaking
- **Label em português:** Mascaramento / Camuflagem
- **Status:** Recurso Pro (requer licença paga)
- **Presente desde:** SnapAway v1.x

---

## O que o Cloaking faz?

Quando ativado, o Cloaking altera três aspectos visuais do SnapAway:

### 1. Nome da janela (titlebar)
O título da janela principal do SnapAway é alterado para o nome personalizado definido pelo usuário.

### 2. Tooltip da bandeja do sistema (tray)
O texto que aparece ao passar o mouse sobre o ícone do SnapAway na bandeja do sistema é alterado para o nome personalizado.

### 3. Ícone personalizado
O usuário pode selecionar uma imagem (PNG, JPG, SVG, ICO) para substituir:
- O ícone da barra de título da janela principal
- O ícone da bandeja do sistema
- O ícone do botão flutuante (floating button)

---

## O que NÃO é afetado pelo Cloaking

- **Auto Launch:** O nome/ícone de inicialização automática não pode ser alterado dinamicamente
- **Processos:** O nome do processo executável (`SnapAway.exe`) permanece o mesmo
- **Funcionalidade:** O aplicativo continua funcionando normalmente — apenas a identidade visual é mascarada

---

## Configurações relacionadas (arquivo de configuração)

```json
{
  "cloakEnabled": false,
  "cloakName": "",
  "cloakIconPath": null
}
```

Essas configurações estão em `src/config/defaults.json`.

---

## Disponibilidade

| Plano | Cloaking disponível? |
|---|---|
| Free | ❌ Não — exibe modal "Pro feature" |
| Pro (Lifetime) | ✅ Sim — funcionalidade completa |

No **Microsoft Store**, o Cloaking está incluído no produto "SnapAway Pro Lifetime" (ID: `9NNLVZPCLLTZ`), dentro da funcionalidade **"Advanced Customization"** descrita como:
> "Unlock all advanced customization and cloaking features."

---

## Como usar

1. Abra as configurações do SnapAway
2. Vá até a seção de atalhos / personalização
3. Ative a opção "Cloaking" / "Mascaramento"
4. Digite o nome personalizado desejado
5. Clique em "Select Icon" para escolher uma imagem personalizada
6. O SnapAway aplica automaticamente as alterações

---

## Código relevante

- **Main process:** `src/main/index.js` — função `applyCloaking()` gerencia toda a lógica de aplicar/reverter o cloaking
- **Icon processor:** `src/cloak/icon-processor.js` — classe `IconProcessor` processa e salva o ícone em formatos apropriados
- **Preload:** `src/preload/index.js` — expõe as APIs `selectCloakIcon`, `setCloakIcon`, `applyCloaking`, `clearCloakIcon`
- **Renderer UI:** `src/renderer/components/ShortcutSetter.svelte` — interface do usuário para configurar cloaking
- **Renderização:** `src/renderer/index.html` — listeners para atualizar ícone e título em tempo real

---

## Traduções (exemplos)

| Idioma | Label | Descrição |
|---|---|---|
| 🇺🇸 English | Cloaking | Hide app identity with custom name and icon |
| 🇧🇷 Português | Mascaramento | Ocultar a identidade do app com nome e ícone personalizados |
| 🇪🇸 Español | Ocultamiento | Ocultar la identidad de la app con nombre e ícono personalizados |
| 🇩🇪 Deutsch | Tarnung | App-Identität mit benutzerdefiniertem Namen und Symbol verbergen |
| 🇫🇷 Français | Cloaking | Masquer l'identité de l'application avec un nom et une icône personnalisés |
| 🇯🇵 日本語 | クローキング | カスタム名とアイコンでアプリのIDを隠す |

---

## Possíveis perguntas e respostas para o bot

**P: O SnapAway tem um recurso de Cloaking?**
R: Sim! O Cloaking é um recurso Pro que permite alterar o nome e o ícone do SnapAway para dificultar que outras pessoas identifiquem o aplicativo.

**P: Como ativo o Cloaking?**
R: O Cloaking está disponível apenas na versão Pro. Após adquirir a licença, vá em Configurações > Atalhos e ative a opção "Cloaking". Você pode definir um nome personalizado e escolher um ícone.

**P: O Cloaking esconde meus apps?**
R: Não, o Cloaking não tem relação com esconder aplicativos. A funcionalidade de esconder apps é feita pelo atalho de teclado (Hide Key). O Cloaking apenas disfarça o próprio SnapAway no sistema.

**P: Preciso pagar para usar o Cloaking?**
R: Sim, o Cloaking é um recurso exclusivo da licença SnapAway Pro Lifetime.

**P: O que posso personalizar com o Cloaking?**
R: Você pode personalizar o nome que aparece na janela e na bandeja do sistema, e também alterar o ícone do aplicativo por uma imagem de sua escolha.
