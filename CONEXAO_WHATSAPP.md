# Conexão com o WhatsApp real — o que a pesquisa mostrou e o que foi implementado

Este documento existe para você decidir com informação de verdade antes de ligar qualquer coisa no seu número real. **Nada aqui foi ativado automaticamente** — o código está pronto, mas só funciona depois que você mesmo preencher credenciais no `.env` e cadastrar o webhook no painel da Meta.

## 1. O que a pesquisa oficial mostrou (Meta for Developers, setembro/2026)

Fontes consultadas: [Webhooks overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview), [Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started), [About the Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform), [Conversation-based pricing (deprecada)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/conversation-based-pricing), documentação de coexistência (360dialog) e reportagens de mercado sobre a mudança de preço de 2025.

### Custo — não é gratuito para sempre
- **Usar a plataforma (Cloud API) não tem mensalidade.** Você só paga por mensagem.
- **Mensagens dentro da janela de 24h aberta pelo cliente são gratuitas** (respostas normais de atendimento).
- **Mensagens de template** (para reabrir contato depois de 24h, ou puxar uma conversa nova) **têm cobrança por envio** desde julho/2025 — antes era por "conversa", agora é por mensagem, valor varia por país e categoria (ex.: campo pesquisado mostrou algo como R$ 0,06–0,15 por mensagem de marketing no Brasil — **não confie nesse número, ele muda; confira o valor atual na hora de configurar**).
- **A Meta exige um cartão de crédito cadastrado na conta comercial (WABA)** antes de liberar o envio de mensagens de template em produção — sem isso, mensagens fora da janela de 24h ficam bloqueadas. Isso significa que existe uma etapa, mais à frente, em que você mesmo vai decidir se cadastra um cartão — eu não vou fazer isso por você (é justamente o tipo de dado financeiro que não insiro em formulário nenhum).
- **Teste é de graça**: ao criar o app na Meta, você já ganha um número de teste que manda mensagem sem cartão cadastrado, limitado a 5 números de destino cadastrados por você.

### Requisitos para produção (não teste)
- Conta comercial na Meta (Business Manager) + um "app" no Meta for Developers com o produto WhatsApp.
- Sem verificação de identidade da empresa (Business Verification — documentos, 2 a 10 dias úteis), o número fica limitado a 250 conversas por 24h.
- Número de telefone dedicado (não pode ser um número que já está no WhatsApp pessoal comum sem passar pelo processo de migração/verificação).

### Como o recebimento de mensagens funciona
- Webhook: a Meta manda um `POST` para uma URL sua a cada mensagem recebida, confirmação de entrega/leitura, etc.
- Antes disso, faz um "handshake" de verificação (`GET` com `hub.mode`, `hub.verify_token`, `hub.challenge`) — você escolhe o `verify_token`, cadastra o mesmo valor dos dois lados.
- Cada `POST` vem assinado (`X-Hub-Signature-256`, HMAC-SHA256 usando o "App Secret" da Meta) — dá pra confirmar que a mensagem realmente veio da Meta, não de qualquer um que descobrisse a URL.
- Se seu servidor não responder `200`, a Meta tenta de novo, com intervalo crescente, **por até 7 dias** — ou seja, o mesmo evento pode chegar duplicado, sua aplicação precisa saber ignorar repetição.
- Limite de 3 MB por payload.

### A limitação mais importante — leia antes de prometer qualquer métrica

**A Cloud API não tem nenhum campo, evento ou conceito nativo de "essa mensagem foi enviada pelo robô" vs. "essa mensagem foi enviada por um humano", nem de "conversa foi transferida".** Isso não existe do lado da Meta. Pesquisei especificamente (handover protocol, distinção bot/humano) e não há esse recurso para WhatsApp — o "Handover Protocol" que existe é do Messenger, não do WhatsApp.

Isso significa uma coisa concreta:

- **Se o Hub Action for o único sistema que manda mensagem de saída** (tanto a resposta automática quanto a resposta do atendente humano passam pelo nosso servidor, que já registra a autoria — é exatamente o que o simulador já faz hoje) → a medição de espera, autoria e o resto do diferencial continuam 100% confiáveis, porque a autoria vem do nosso próprio banco, não da Meta.
- **Se o seu robô ou seus atendentes continuarem respondendo por outro canal** (o app oficial do WhatsApp Business, uma plataforma de atendimento separada, outro sistema que também fala com a Cloud API) → o webhook só nos entrega as mensagens que o **cliente** mandou. As respostas que saem por fora do Hub Action não aparecem pra gente, e não tem como saber se quem respondeu foi robô ou humano, nem detectar transferência. Nesse cenário, os indicadores de espera ficariam incompletos ou errados — por isso não vou implementar isso hoje sem saber qual é o seu caso.

Isso é exatamente o motivo da pergunta que vou te fazer antes de avançar na parte que depende disso.

## 2. O que já foi implementado agora (não depende de credencial pra existir no código)

- **Recebimento oficial**: rota de webhook (`GET`/`POST /webhooks/whatsapp`) com verificação de assinatura, deduplicação (usa o `wamid` da mensagem — se a Meta reentregar o mesmo evento, não duplica nem reabre espera encerrada) e tratamento de tipos de mensagem não suportados ainda (imagem, áudio etc. viram um aviso, não travam nem se perdem).
- **Multiempresa desde o webhook**: cada número (`phone_number_id`) é associado a uma empresa (`whatsapp_connections`); o webhook descobre a empresa certa pelo número que recebeu a mensagem — o isolamento entre empresas vale também para o WhatsApp real.
- **Reaproveita 100% do motor já existente**: a mensagem recebida vira uma `CLIENTE` normal, passa pela mesma detecção de "quero atendente" (com as mesmas negações), mesma máquina de estados, mesmo cronômetro de espera — nada foi duplicado.
- **Envio real**: quando uma conversa é do canal `WHATSAPP_OFICIAL`, o botão "Responder" da tela de Conversas chama de verdade a Graph API (mensagem de sessão, gratuita dentro da janela de 24h). Sem `WHATSAPP_ACCESS_TOKEN` configurado, recusa com erro claro em vez de travar.
- **Segredos só no servidor**: token de acesso, segredo do app e verify token vivem em variáveis de ambiente (arquivo `.env`, nunca commitado — já está no `.gitignore`). Veja `.env.example` para a lista completa comentada.
- **Simulador continua separado**: nada disso mexe nas rotas `/simular/*` nem no botão de simular falha — o canal `SIMULADO` continua exatamente como antes.
- Testado com 25 testes automatizados (`npm test`) e um teste manual de ponta a ponta simulando uma entrega real assinada da Meta (assinatura errada rejeitada, assinatura certa aceita, reentrega do mesmo evento não duplica, número não cadastrado não quebra nada).

## 3. Como configurar as credenciais com segurança

1. Copie `.env.example` para `.env` (esse arquivo nunca vai para o Git).
2. Crie uma conta de desenvolvedor em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo "Empresa" e adicione o produto WhatsApp.
3. Na tela "Configuração da API" do app, você já tem um **número de teste gratuito** — não precisa de cartão nem de número real ainda. Cadastre seu próprio celular como destinatário autorizado.
4. Gere um token de acesso temporário (24h) primeiro, só para testar; guarde o `phone_number_id` que aparece na tela.
5. Em "Configurações do app → Básico", copie a "Chave Secreta do Aplicativo" → isso é o `WHATSAPP_APP_SECRET`.
6. Invente um valor qualquer (uma string longa aleatória) para `WHATSAPP_VERIFY_TOKEN` — não vem da Meta, é você quem escolhe, e cadastra o mesmo valor na tela de configuração do webhook do app.
7. Preencha `.env` com esses três valores.
8. Rode `npx tsx src/conectar-whatsapp.ts empresa-demo-a <phone_number_id>` (troque o slug pela empresa certa) para associar o número de teste a uma empresa do Hub Action.
9. Para a Meta conseguir chamar seu webhook, seu servidor precisa estar acessível pela internet — em localhost isso não funciona sozinho; para testar localmente, uma opção comum é um túnel temporário (ex.: `ngrok`) só durante o teste — isso é opcional e fica a seu critério, não é algo que ativei ou instalei.
10. Cadastre a URL pública + o `WHATSAPP_VERIFY_TOKEN` na tela de Webhooks do app, assine o campo `messages`.
11. Rode `npm run dev` e mande uma mensagem do seu celular (um dos números autorizados) para o número de teste — ela deve aparecer na Caixa de Entrada da empresa associada.

Nunca cole nenhum desses valores em código, print compartilhado ou mensagem de chat — são credenciais de acesso à sua conta comercial.

## 4. Antes de conectar seu número REAL (o que já está em produção hoje) — checklist que precisa da sua autorização

Isso é diferente de testar com o número de sandbox. Conectar o número que seus clientes já usam pode interromper ou duplicar o atendimento atual. **Não vou fazer nenhum desses passos sozinho — apresento aqui, você autoriza item por item:**

1. Confirmar qual é hoje o caminho do seu número (app oficial do WhatsApp Business? já está em alguma API/BSP? outra ferramenta?) — depende da resposta que vou te pedir a seguir.
2. Se o número está no app comum do WhatsApp Business hoje, migrar para a Cloud API **normalmente desliga o app comum nesse número** — a não ser que você use o recurso de **Coexistência** (2025+), que permite manter os dois ao mesmo tempo, mas geralmente passa por um parceiro/BSP (ex.: 360dialog), não é direto com a Meta. Se isso te interessar, é uma conversa à parte antes de qualquer migração.
3. Definir a janela de corte (dia/horário de baixo movimento) e um plano de rollback.
4. Testar tudo no número de sandbox primeiro (semanas 1–2 se possível) antes de tocar no número real.
5. Só depois de aprovado por você: migrar/cadastrar o número real, cadastrar o webhook de produção, e nesse momento sim considerar o cartão de crédito da Meta (só necessário se for usar mensagens de template fora da janela de 24h).

## 5. Pendências / próxima etapa

- **Aguardando sua resposta** sobre plataforma atual e onde seus atendentes respondem hoje (pergunta feita na conversa) — isso define se dá para conectar via Hub Action com métricas confiáveis, ou se precisa de uma arquitetura diferente.
- Envio de mensagens de **template** (para reabrir conversa fora da 24h) não foi implementado — tem custo por envio e exige aprovação prévia do template pela Meta; fica para quando você decidir usar esse recurso.
- `statuses` do webhook (confirmação de entrega/leitura das mensagens que nós enviamos) são recebidos mas ainda não usados em nenhuma tela.
- Hoje só é possível associar um número por empresa via linha de comando (`conectar-whatsapp.ts`) — não existe tela para isso ainda.
- Nenhuma etapa de publicação/hospedagem foi decidida — continua tudo local, como combinado.
