# Guia do Proprietário — HUB ACTION Command Center

Escrito para quem vai **operar** o sistema, não para programador. Cada passo diz onde clicar e o que esperar. Onde algo ainda depende de configuração externa (Meta, Google), está dito claramente.

Endereço do sistema: **https://hub-action-crm-demo.onrender.com**

---

## 1. Como entrar no painel administrador

1. Abra o endereço acima e entre com o e-mail do **Administrador Geral** (a conta separada criada para você — `admin.geral@hubaction.dev`).
2. Você cai em **Administração Hub Action**. No topo há os atalhos: **Integrações**, **Marketing**, **Agência**, **Conexões do WhatsApp**, **Log de auditoria**.
3. Esqueceu a senha? Outro administrador geral gera um "Link de nova senha" na lista de usuários. Se ninguém tiver acesso, a Hub Action gera o link direto no banco (procedimento técnico).

## 2. Como cadastrar uma empresa

1. Em **Administração Hub Action**, digite o nome em "Nome da nova empresa cliente" e clique em **Criar empresa**.
2. No card da empresa, gere um **convite de administrador** (e-mail do cliente) — aparece um link. Envie o link para o cliente (WhatsApp, e-mail). Ele cria a própria senha e cai só no painel dele.
3. O plano (Demonstração / Piloto / Ativo) é só um rótulo — não cobra nada.

## 3. Como conectar o WhatsApp

1. **Conexões do WhatsApp** → no card da empresa, informe WABA ID, Phone Number ID, ambiente (Teste/Produção) e o Access Token → **Cadastrar conexão**.
2. Clique em **Testar conexão**. Só passa se a Meta confirmar que o número pertence àquele WABA.
3. Cadastre a URL do webhook (mostrada na tela, botão "Copiar URL") + o Verify Token no app da Meta e assine o campo `messages`.
4. Só então clique em **Ativar**.

## 4. Como conectar o Meta Ads

Pré-requisito (uma vez, no servidor): `META_APP_ID` e `META_APP_SECRET` configurados no Render, e a URL `https://hub-action-crm-demo.onrender.com/admin/integracoes/meta/callback` cadastrada no app da Meta em "URIs de redirecionamento do OAuth válidos". Enquanto isso não existir, a tela mostra exatamente o que falta.

1. **Integrações** → card **Meta Ads** → **Conectar Meta Ads**.
2. Você vai para a tela da Meta: entre com a conta que tem acesso ao Gerenciador de Anúncios e autorize. O sistema pede só **leitura** (ads_read e read_insights) — ele não cria, edita nem pausa campanha.
3. De volta ao HUB ACTION, clique em **Listar contas** na conexão: as contas de anúncio acessíveis aparecem na tabela "Contas de anúncio descobertas".

## 5. Como conectar o Google Ads

Pré-requisito (uma vez): projeto no Google Cloud com a **Google Ads API** ativada e um cliente OAuth "Web application" com a URL `https://hub-action-crm-demo.onrender.com/admin/integracoes/google/callback` autorizada; `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no Render. Desde setembro/2026 o nível de acesso à API é definido pelo projeto Cloud (o antigo developer token deixou de contar) — peça acesso "Basic" pela página "Google Ads API" do projeto se ainda estiver em teste.

1. **Integrações** → card **Google Ads** → **Conectar Google Ads** → autorize com a conta Google que enxerga as contas de anúncio (pode ser uma conta gerenciadora/MCC).
2. **Listar contas**: aparecem as contas acessíveis; se for gerenciadora, também as contas-cliente diretas.

## 6. Como selecionar a conta correta

Na tabela de contas, confira **nome, ID externo, moeda e fuso**. Conta gerenciadora (MCC) aparece marcada — normalmente você vincula a conta-cliente, não a gerenciadora.

## 7. Como associar a conta à empresa

1. Na linha da conta, escolha a empresa em "Empresa vinculada", marque **sincronizar** e clique em **Salvar**.
2. Uma conta pertence a **uma** empresa. A empresa só vê as contas dela. Para trocar de empresa, escolha outra e salve (fica registrado na auditoria).
3. **Desvincular** faz as campanhas e métricas daquela conta sumirem do painel da empresa (nada é apagado do banco).

## 8. Como verificar a sincronização

- Na tabela de contas: coluna **Estado** (Sincronizando / Aguardando 1ª sincronização / Dados antigos / Erro / Reconexão necessária) e **Última sync / sucesso**.
- **Atualizar agora** (por conta) ou **Atualizar todas agora** força a busca. A primeira busca traz 90 dias; as seguintes só a última semana.
- **Marketing** (painel geral) → "Sincronizações recentes" mostra cada execução com janela, quantidade e erro.
- No painel da empresa aparece "Dados atualizados há X min" — se estiver amarelo, os dados têm mais de 6 horas.
- Importante: no plano gratuito do Render a instância dorme sem uso; a sincronização automática (a cada 60 min) só roda enquanto ela está acordada. Para operação contínua, o plano pago é necessário.

## 9. Como corrigir "reconexão necessária"

Acontece quando o token expirou ou a autorização foi removida na Meta/Google.

1. **Integrações** → na conexão, clique em **Conectar Meta Ads / Google Ads** de novo e autorize.
2. As contas já vinculadas continuam vinculadas; clique em **Atualizar agora**.
3. Se o erro persistir, leia a mensagem na coluna "Última sync" (já vem sem dados sensíveis) — permissão negada costuma ser a conta Google/Meta sem acesso àquela conta de anúncio.

## 10. Como ler o CPL

**CPL = investimento ÷ leads.** Lead é todo contato novo que chegou no CRM no período. Um CPL baixo diz que os leads estão baratos — **não** diz que são bons.

## 11. Como ler o CAC

**CAC = investimento ÷ clientes novos.** É o que você pagou para conquistar cada cliente que comprou. É o número que importa para o caixa. Se o CPL cai e o CAC sobe, os leads ficaram mais baratos e piores.

## 12. Como ler o ROAS

**ROAS = receita atribuída ÷ investimento.** 4,8x significa que cada R$ 1 investido voltou R$ 4,80 em vendas de contatos que vieram dos anúncios. Só entram vendas com atribuição confirmada ou provável — venda de indicação não conta como retorno de anúncio.

## 13. Como comparar Meta e Google

**Quem vê o Marketing da empresa**: o administrador geral da Hub Action (em qualquer empresa, mesmo vinculado como atendente), o administrador da empresa e o atendente com a permissão `can_view_marketing` ligada. O menu da empresa é OPERAÇÃO / MARKETING (Visão Geral, Meta Ads, Google Ads, Campanhas, Funil & Conversão, Inteligência, Alertas) / GESTÃO — Meta Ads e Google Ads aparecem SEMPRE, com um ponto verde (conectado) ou cinza (não conectado). Um provedor sem conta vinculada mostra um aviso profissional em vez de dados; nada é estimado.

**Telas de marketing da empresa**: Dashboard (visão consolidada Meta + Google + CRM), Visão Geral, Meta Ads, Google Ads, Campanhas, Funil & Conversão, Conteúdo / Criativos, Inteligência (leitura gerencial), Metas (metas do mês, projeção e limites de CPL/CAC/ROAS) e Alertas. Blocos com "estrutura pronta" (público, posicionamento, palavras-chave, mídia por anúncio) mostram "sem dados ainda" até a sincronização buscar esses detalhamentos — nada é estimado.

**Dados reais x demonstração**: enquanto `DEMO_MODE` estiver ligado, a central marca "CRM — dados de demonstração" e as métricas que misturam investimento real com CRM (CPL, CAC, ROAS, receita atribuída) recebem o selo "híbrido". Desligue `DEMO_MODE=false` no Render quando o CRM passar a ser real.

**Marketing → aba Visão Geral → bloco "Meta Ads x Google Ads"**: investimento, leads, qualificados, clientes, CPL, CAC, receita e ROAS lado a lado. Se aparecer o aviso "atribuição apenas provável", parte dos leads daquele canal foi identificada por UTM, não por identificador oficial — trate como estimativa.

## 14. Como identificar campanha ruim

Na **tabela de campanhas** ou em **Precisa de atenção**:
- investiu e **não gerou lead atribuído**;
- **CAC muito acima da média** da empresa;
- muitas conversas e **poucos qualificados** (custo por qualificado alto);
- CTR caindo com frequência subindo (mesmas pessoas vendo o anúncio várias vezes).

## 15. Como identificar campanha boa

- **CAC abaixo da média** com volume de clientes (não só 1 venda);
- **taxa de qualificação alta**;
- no gráfico "Custo x fechamento" (Campanhas): bolha à esquerda (CPL baixo) e alta (fecha bem).

## 16. Como saber se o problema está no anúncio ou na venda

Use o **Funil** (Marketing → Funil, ou Inteligência → Detector de gargalos):
- Muitos cliques → poucas conversas: problema de página/oferta/chamada do anúncio.
- Muitas conversas → poucos qualificados: público ou promessa do anúncio.
- Muitos qualificados → poucos agendamentos: abordagem comercial.
- Muitos agendamentos → poucos comparecimentos: confirmação e follow-up.
- Muitos comparecimentos → poucas vendas: fechamento.
O sistema diz "**possível** gargalo" — é um ponto para investigar, não uma sentença.

## 17. Como colocar a empresa em produção

1. WhatsApp conectado, testado e ativado (seção 3).
2. Contas Meta/Google vinculadas e sincronizando (seções 4–8).
3. No CRM da empresa, **Configurar etapas**: marque qual etapa "conta como lead qualificado" e qual "conta como comparecimento" — é isso que alimenta CPL qualificado e custo por comparecimento.
4. Na **Inteligência**, o administrador da empresa define as **metas do mês** (faturamento, clientes, CAC máximo etc.).
5. Em **Administração Hub Action**, mude o plano da empresa para **Ativo**.
6. Para uso real contínuo, migrar o serviço no Render para um plano que não dorme.

## O que ainda depende de fora (não esconda isso do cliente)

- Credenciais Meta (`META_APP_ID/SECRET`) e Google (`GOOGLE_CLIENT_ID/SECRET`) precisam ser criadas por você nos respectivos painéis e coladas no Render.
- Nível de acesso da Google Ads API (Basic) aprovado pelo Google para o projeto Cloud.
- Se o app da Meta estiver em modo de desenvolvimento, só usuários do app conseguem autorizar; para clientes externos, o app precisa passar pela revisão da Meta para `ads_read`.
- Nenhuma conexão real foi testada pela Hub Action até você fornecer essas credenciais — a arquitetura foi validada com simulações das APIs.
