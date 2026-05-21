# Community Smoke Checklist

Objetivo: validar em poucos minutos que a versão community está funcional, sem partes privadas locais.

## Pré-requisitos

- Executar em clone sem pasta private.
- Sem certificados, chaves e segredos locais carregados.
- Dependências instaladas com npm ci ou npm install.

## Etapa 1: gates automáticos

1. Executar npm run verify:open-core.
2. Executar npm run verify:community.
3. Resultado esperado: ambos finalizam com exit code 0.

## Etapa 2: subida local

1. Executar npm run dev.
2. Abrir a aplicação e confirmar carregamento da UI principal.
3. Resultado esperado: app abre sem erro fatal no main/renderer.

## Etapa 3: fluxo Pro em modo community

1. Abrir o modal Pro na interface.
2. Verificar mensagem de fallback quando billing não estiver disponível.
3. Verificar presença de diagnóstico de capability quando exibido (mode e/ou reason).
4. Clicar em compra e confirmar fallback para openPaymentPage quando Store IAP não estiver disponível.
5. Resultado esperado: sem crash, sem freeze, retorno tratável ao usuário.

## Etapa 4: fluxo IAP de diagnóstico

1. Executar npm run test:iap:quick.
2. Resultado esperado:
- getProducts retorna estrutura válida.
- getLicenseInfo retorna estrutura válida.
- checkOwnership retorna estrutura válida.
- requestPurchase pode retornar erro de UI thread no script headless sem invalidar o smoke.

## Etapa 5: validação de higiene de publicação

1. Confirmar que private/ não é versionado.
2. Confirmar que .gitignore contém regras para privado local e artefatos sensíveis.
3. Confirmar que .npmignore bloqueia private/ e material sensível no pacote.

## Critério de aprovação

- Gate automáticos verdes.
- UI abre e navega sem falha fatal.
- Fluxo Pro funciona em fallback de forma clara e estável.
- Nenhuma dependência obrigatória de módulo privado detectada.
