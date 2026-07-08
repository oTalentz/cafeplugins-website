// =====================================================
//  Internacionalização (i18n) - Cafe Plugins
//  Suporta: pt-BR, pt-PT, en, es
// =====================================================

const I18N = {
  defaultLocale: 'pt-BR',
  currentLocale: 'pt-BR',
  
  translations: {
    'pt-BR': {
      // Navbar
      'nav.plugins': 'Plugins',
      'nav.how_it_works': 'Como funciona',
      'nav.affiliates': 'Afiliados',
      'nav.faq': 'FAQ',
      'nav.panel': 'Painel',
      'nav.cart': 'Carrinho',
      
      // Hero
      'hero.eyebrow': 'Loja de plugins para Minecraft',
      'hero.title': 'Plugins premium para o seu servidor de Minecraft.',
      'hero.lead': 'Plugins prontos, bem documentados e com suporte real. PvP, economia, facções, lobby e muito mais — tudo o que você precisa para um servidor que os jogadores não querem largar.',
      'hero.cta_primary': 'Ver plugins',
      'hero.cta_secondary': 'Como funciona',
      'hero.stats.downloads': 'downloads',
      'hero.stats.rating': 'avaliação média',
      'hero.stats.support': 'suporte',
      
      // Catalog
      'catalog.title': 'Plugins',
      'catalog.subtitle': 'Tudo o que você precisa para deixar seu servidor com a sua cara.',
      'filters.all': 'Todos',
      'filters.free': 'Grátis',
      'filters.paid': 'Pago',
      
      // How it works
      'hiw.title': 'Como funciona',
      'hiw.subtitle': 'Em 3 minutos seu servidor está com cara nova.',
      'hiw.step1.title': 'Escolha o plugin',
      'hiw.step1.desc': 'Veja demos, versões e avaliações antes de comprar.',
      'hiw.step2.title': 'Pague seguro',
      'hiw.step2.desc': 'Pix e cartão. Receba o link de download na hora.',
      'hiw.step3.title': 'Instale e jogue',
      'hiw.step3.desc': 'Solte o .jar em /plugins, reinicie e aproveite.',
      
      // FAQ
      'faq.title': 'Perguntas frequentes',
      'faq.q1': 'Os plugins recebem atualizações?',
      'faq.a1': 'Sim. Todas as compras incluem 1 ano de updates. Você pode renovar com 50% de desconto.',
      'faq.q2': 'Funciona em qual versão do Minecraft?',
      'faq.a2': 'A maioria suporta 1.16+ até a versão mais recente. Cada plugin mostra sua compatibilidade no card.',
      'faq.q3': 'Tem suporte?',
      'faq.a3': 'Suporte 24/7 no nosso Discord e por e-mail. Resposta média em 2 horas.',
      'faq.q4': 'Posso usar em vários servidores?',
      'faq.a4': 'A licença padrão cobre 1 servidor. Para multi-servidor, fale com a gente — temos planos especiais.',
      
      // Affiliates
      'aff.title': 'Indique e <span class="grad-word">ganhe</span>',
      'aff.subtitle': 'Você tem amigos com servidor de Minecraft? Indique nossos plugins e ganhe <strong>25% de comissão</strong> em cada venda — para sempre.',
      'aff.stats.commission': '25% de comissão',
      'aff.stats.cookie': '30 dias de cookie',
      'aff.stats.payment': 'Pagamento mensal',
      'aff.stats.unlimited': 'Indicações ilimitadas',
      'aff.how.title': 'Como funciona',
      'aff.how.step1.title': 'Crie sua conta',
      'aff.how.step1.desc': 'Abra o <strong>Painel</strong> no topo da página, cadastre-se e ative o programa de afiliados na sua conta.',
      'aff.how.step2.title': 'Compartilhe',
      'aff.how.step2.desc': 'Use seu código e link exclusivos — disponíveis no seu painel — em vídeos, Discord e redes sociais.',
      'aff.how.step3.title': 'Receba',
      'aff.how.step3.desc': 'A cada compra feita com seu código, você ganha 25% do valor. Acompanhe tudo e solicite o saque pelo painel.',
      'aff.cta.title': 'Programa de afiliados',
      'aff.cta.desc': 'O cadastro e o gerenciamento de afiliado são feitos dentro do seu painel, junto com suas compras e dados.',
      'aff.cta.button': 'Abrir Painel',
      'aff.cta.note': 'Se for novo por aqui, clique em <strong>Cadastrar</strong> dentro do painel.',
      
      // Footer
      'footer.tagline': 'Plugins premium para servidores de Minecraft. Feito por jogadores, para jogadores.',
      'footer.shop': 'Loja',
      'footer.support': 'Suporte',
      'footer.company': 'Empresa',
      'footer.discord': 'Discord',
      'footer.docs': 'Documentação',
      'footer.contact': 'Contato',
      'footer.about': 'Sobre',
      'footer.terms': 'Termos',
      'footer.privacy': 'Privacidade',
      'footer.copyright': '© 2026 cafe · plugins. Não afiliado à Mojang AB.',
      
      // Cart
      'cart.title': 'Carrinho',
      'cart.empty': 'Seu carrinho está vazio',
      'cart.total': 'Total',
      'cart.checkout': 'Finalizar compra',
      'cart.remove': 'Remover',
      
      // Checkout
      'checkout.title': 'Finalizar compra',
      'checkout.desc': 'Preencha seus dados. Após a confirmação, você receberá o link de download por e-mail.',
      'checkout.name': 'Nome',
      'checkout.name_placeholder': 'Seu nome',
      'checkout.email': 'E-mail',
      'checkout.email_placeholder': 'voce@email.com',
      'checkout.payment': 'Forma de pagamento',
      'checkout.payment.pix': 'Pix (pagamento instantâneo)',
      'checkout.payment.card': 'Cartão de crédito (até 12x)',
      'checkout.payment.boleto': 'Boleto',
      'checkout.affiliate': 'Código de afiliado (opcional)',
      'checkout.affiliate_placeholder': 'Ex: JOAO42',
      'checkout.confirm': 'Confirmar pagamento',

      'checkout.payment.note': 'PIX transparente e cartão via checkout seguro do Mercado Pago ou AbacatePay.',
      // Payment methods
      'payment.pix.title': 'Pagar com Pix',
      'payment.pix.expires': 'Expira em',
      'payment.pix.expired': 'PIX expirado',
      'payment.pix.waiting': 'Aguardando pagamento…',
      'payment.pix.paid': 'Pago! Licença liberada.',
      'payment.pix.copy': 'Copiar código',
      'payment.pix.copied': 'Código PIX copiado',
      'payment.pix.failed': 'Pedido criado, mas a cobrança PIX falhou. Use o link "Ver minha conta" para tentar novamente.',
      'payment.card.redirect': 'Redirecionando para pagamento com cartão...',
      'payment.card.unavailable': 'Pagamento com cartão indisponível. Tente novamente ou use PIX.',

      // Auth
      'auth.login': 'Entrar',
      'auth.register': 'Cadastrar',
      'auth.logout': 'Sair',
      'auth.login_required': 'Faça login para continuar a compra',
      'auth.email': 'E-mail',
      'auth.password': 'Senha',
      'auth.forgot': 'Esqueci minha senha',
      'auth.no_account': 'Não tem conta? Cadastrar',
      'auth.has_account': 'Já tem conta? Entrar',
      'auth.recover': 'Recuperar senha',
      'auth.verify_email': 'Confirme seu e-mail',
      'auth.code_sent': 'Código enviado',
      'auth.code_placeholder': '000000',
      'auth.send_code': 'Enviar código',
      'auth.validate_code': 'Validar código',
      'auth.new_password': 'Nova senha',
      'auth.confirm_password': 'Confirmar nova senha',
      'auth.save_password': 'Salvar nova senha',
      'auth.back': 'Voltar',
      'auth.resend': 'Reenviar código',
      
      // Account
      'account.title': 'Minha Conta',
      'account.orders': 'Minhas Compras',
      'account.affiliate': 'Afiliado',
      'account.settings': 'Configurações',
      'account.no_orders': 'Você ainda não fez compras',
      'account.view_downloads': 'Ver meus downloads',
      'account.view_pix_qr': 'Ver QR do Pix',
      'account.create_password': 'Criar senha e acessar',

      // Toasts
      'toast.added_cart': 'Adicionado ao carrinho',
      'toast.removed_cart': 'Removido do carrinho',
      'toast.invalid_email': 'E-mail inválido',
      'toast.fill_name_email': 'Preencha nome e e-mail',
      'toast.invalid_affiliate': 'Código de afiliado inválido',
      'toast.own_code': 'Você não pode usar seu próprio código de afiliado',
      'toast.order_created': 'Pedido criado!',
      'toast.payment_confirmed': 'Pagamento confirmado! Seus plugins estão liberados.',
      'toast.download_started': 'Download iniciado',
      
      // Language selector
      'lang.select': 'Idioma',
      'lang.pt-BR': 'Português (BR)',
      'lang.pt-PT': 'Português (PT)',
      'lang.en': 'English',
      'lang.es': 'Español'
    },
    
    'pt-PT': {
      // Navbar
      'nav.plugins': 'Plugins',
      'nav.how_it_works': 'Como funciona',
      'nav.affiliates': 'Afiliados',
      'nav.faq': 'FAQ',
      'nav.panel': 'Painel',
      'nav.cart': 'Carrinho',
      
      // Hero
      'hero.eyebrow': 'Loja de plugins para Minecraft',
      'hero.title': 'Plugins premium para o seu servidor de Minecraft.',
      'hero.lead': 'Plugins prontos, bem documentados e com suporte real. PvP, economia, fações, lobby e muito mais — tudo o que precisa para um servidor que os jogadores não querem largar.',
      'hero.cta_primary': 'Ver plugins',
      'hero.cta_secondary': 'Como funciona',
      'hero.stats.downloads': 'transferências',
      'hero.stats.rating': 'classificação média',
      'hero.stats.support': 'Suporte',
      
      // Catalog
      'catalog.title': 'Plugins',
      'catalog.subtitle': 'Tudo o que precisa para deixar o seu servidor à sua maneira.',
      'filters.all': 'Todos',
      'filters.free': 'Grátis',
      'filters.paid': 'Pago',
      
      // How it works
      'hiw.title': 'Como funciona',
      'hiw.subtitle': 'Em 3 minutos o seu servidor está com cara nova.',
      'hiw.step1.title': 'Escolha o plugin',
      'hiw.step1.desc': 'Veja demonstrações, versões e avaliações antes de comprar.',
      'hiw.step2.title': 'Pague com segurança',
      'hiw.step2.desc': 'Pix e cartão. Receba o link de transferência imediatamente.',
      'hiw.step3.title': 'Instale e jogue',
      'hiw.step3.desc': 'Coloque o .jar em /plugins, reinicie e aproveite.',
      
      // FAQ
      'faq.title': 'Perguntas frequentes',
      'faq.q1': 'Os plugins recebem atualizações?',
      'faq.a1': 'Sim. Todas as compras incluem 1 ano de atualizações. Pode renovar com 50% de desconto.',
      'faq.q2': 'Funciona em qual versão do Minecraft?',
      'faq.a2': 'A maioria suporta 1.16+ até à versão mais recente. Cada plugin mostra a sua compatibilidade no cartão.',
      'faq.q3': 'Tem suporte?',
      'faq.a3': 'Suporte 24/7 no nosso Discord e por e-mail. Resposta média em 2 horas.',
      'faq.q4': 'Posso usar em vários servidores?',
      'faq.a4': 'A licença padrão cobre 1 servidor. Para multi-servidor, fale connosco — temos planos especiais.',
      
      // Affiliates
      'aff.title': 'Indique e <span class="grad-word">ganhe</span>',
      'aff.subtitle': 'Tem amigos com servidor de Minecraft? Indique os nossos plugins e ganhe <strong>25% de comissão</strong> em cada venda — para sempre.',
      'aff.stats.commission': '25% de comissão',
      'aff.stats.cookie': '30 dias de cookie',
      'aff.stats.payment': 'Pagamento mensal',
      'aff.stats.unlimited': 'Indicações ilimitadas',
      'aff.how.title': 'Como funciona',
      'aff.how.step1.title': 'Crie a sua conta',
      'aff.how.step1.desc': 'Abra o <strong>Painel</strong> no topo da página, registe-se e ative o programa de afiliados na sua conta.',
      'aff.how.step2.title': 'Partilhe',
      'aff.how.step2.desc': 'Use o seu código e link exclusivos — disponíveis no seu painel — em vídeos, Discord e redes sociais.',
      'aff.how.step3.title': 'Receba',
      'aff.how.step3.desc': 'A cada compra feita com o seu código, ganha 25% do valor. Acompanhe tudo e solicite o levantamento pelo painel.',
      'aff.cta.title': 'Programa de afiliados',
      'aff.cta.desc': 'O registo e a gestão de afiliado são feitos dentro do seu painel, junto com as suas compras e dados.',
      'aff.cta.button': 'Abrir Painel',
      'aff.cta.note': 'Se for novo por aqui, clique em <strong>Registar</strong> dentro do painel.',
      
      // Footer
      'footer.tagline': 'Plugins premium para servidores de Minecraft. Feito por jogadores, para jogadores.',
      'footer.shop': 'Loja',
      'footer.support': 'Suporte',
      'footer.company': 'Empresa',
      'footer.discord': 'Discord',
      'footer.docs': 'Documentação',
      'footer.contact': 'Contacto',
      'footer.about': 'Sobre',
      'footer.terms': 'Termos',
      'footer.privacy': 'Privacidade',
      'footer.copyright': '© 2026 cafe · plugins. Não afiliado à Mojang AB.',
      
      // Cart
      'cart.title': 'Carrinho',
      'cart.empty': 'O seu carrinho está vazio',
      'cart.total': 'Total',
      'cart.checkout': 'Finalizar compra',
      'cart.remove': 'Remover',
      
      // Checkout
      'checkout.title': 'Finalizar compra',
      'checkout.desc': 'Preencha os seus dados. Após a confirmação, receberá o link de transferência por e-mail.',
      'checkout.name': 'Nome',
      'checkout.name_placeholder': 'O seu nome',
      'checkout.email': 'E-mail',
      'checkout.email_placeholder': 'voce@email.com',
      'checkout.payment': 'Forma de pagamento',
      'checkout.payment.pix': 'Pix (pagamento instantâneo)',
      'checkout.payment.card': 'Cartão de crédito (até 12x)',
      'checkout.payment.boleto': 'Boleto',
      'checkout.affiliate': 'Código de afiliado (opcional)',
      'checkout.affiliate_placeholder': 'Ex: JOAO42',
      'checkout.confirm': 'Confirmar pagamento',
      'checkout.payment.note': 'PIX transparente e cartão via checkout seguro do Mercado Pago ou AbacatePay.',

      // Payment methods
      'payment.pix.title': 'Pagar com Pix',
      'payment.pix.expires': 'Expira em',
      'payment.pix.expired': 'PIX expirado',
      'payment.pix.waiting': 'A aguardar pagamento…',
      'payment.pix.paid': 'Pago! Licença libertada.',
      'payment.pix.copy': 'Copiar código',
      'payment.pix.copied': 'Código PIX copiado',
      'payment.pix.failed': 'Pedido criado, mas a cobrança PIX falhou. Usa a ligação "Ver a minha conta" para tentar novamente.',
      'payment.card.redirect': 'A redirecionar para pagamento com cartão...',
      'payment.card.unavailable': 'Pagamento com cartão indisponível. Tenta novamente ou usa Pix.',

      // Auth
      'auth.login': 'Entrar',
      'auth.register': 'Registar',
      'auth.logout': 'Sair',
      'auth.login_required': 'Faça login para continuar a compra',
      'auth.email': 'E-mail',
      'auth.password': 'Palavra-passe',
      'auth.forgot': 'Esqueci-me da palavra-passe',
      'auth.no_account': 'Não tem conta? Registar',
      'auth.has_account': 'Já tem conta? Entrar',
      'auth.recover': 'Recuperar palavra-passe',
      'auth.verify_email': 'Confirme o seu e-mail',
      'auth.code_sent': 'Código enviado',
      'auth.code_placeholder': '000000',
      'auth.send_code': 'Enviar código',
      'auth.validate_code': 'Validar código',
      'auth.new_password': 'Nova palavra-passe',
      'auth.confirm_password': 'Confirmar nova palavra-passe',
      'auth.save_password': 'Guardar nova palavra-passe',
      'auth.back': 'Voltar',
      'auth.resend': 'Reenviar código',
      
      // Account
      'account.title': 'A Minha Conta',
      'account.orders': 'As Minhas Compras',
      'account.affiliate': 'Afiliado',
      'account.settings': 'Configurações',
      'account.no_orders': 'Ainda não fez compras',
      'account.view_downloads': 'Ver as minhas transferências',
      'account.view_pix_qr': 'Ver QR do Pix',
      'account.create_password': 'Criar palavra-passe e aceder',

      // Toasts
      'toast.added_cart': 'Adicionado ao carrinho',
      'toast.removed_cart': 'Removido do carrinho',
      'toast.invalid_email': 'E-mail inválido',
      'toast.fill_name_email': 'Preencha nome e e-mail',
      'toast.invalid_affiliate': 'Código de afiliado inválido',
      'toast.own_code': 'Não pode usar o seu próprio código de afiliado',
      'toast.order_created': 'Pedido criado!',
      'toast.payment_confirmed': 'Pagamento confirmado! Os seus plugins estão libertados.',
      'toast.download_started': 'Transferência iniciada',
      
      // Language selector
      'lang.select': 'Idioma',
      'lang.pt-BR': 'Português (BR)',
      'lang.pt-PT': 'Português (PT)',
      'lang.en': 'English',
      'lang.es': 'Español'
    },
    
    'en': {
      // Navbar
      'nav.plugins': 'Plugins',
      'nav.how_it_works': 'How it works',
      'nav.affiliates': 'Affiliates',
      'nav.faq': 'FAQ',
      'nav.panel': 'Dashboard',
      'nav.cart': 'Cart',
      
      // Hero
      'hero.eyebrow': 'Minecraft Plugin Store',
      'hero.title': 'Premium plugins for your Minecraft server.',
      'hero.lead': 'Ready-to-use, well-documented plugins with real support. PvP, economy, factions, lobby and much more — everything you need for a server players won\'t want to leave.',
      'hero.cta_primary': 'Browse plugins',
      'hero.cta_secondary': 'How it works',
      'hero.stats.downloads': 'downloads',
      'hero.stats.rating': 'average rating',
      'hero.stats.support': 'support',
      
      // Catalog
      'catalog.title': 'Plugins',
      'catalog.subtitle': 'Everything you need to customize your server.',
      'filters.all': 'All',
      'filters.free': 'Free',
      'filters.paid': 'Paid',
      
      // How it works
      'hiw.title': 'How it works',
      'hiw.subtitle': 'Get your server customized in 3 minutes.',
      'hiw.step1.title': 'Choose your plugin',
      'hiw.step1.desc': 'Check demos, versions and reviews before buying.',
      'hiw.step2.title': 'Pay securely',
      'hiw.step2.desc': 'Pix and credit card. Get your download link instantly.',
      'hiw.step3.title': 'Install and play',
      'hiw.step3.desc': 'Drop the .jar in /plugins, restart and enjoy.',
      
      // FAQ
      'faq.title': 'Frequently asked questions',
      'faq.q1': 'Do plugins receive updates?',
      'faq.a1': 'Yes. All purchases include 1 year of updates. You can renew with 50% discount.',
      'faq.q2': 'Which Minecraft version is supported?',
      'faq.a2': 'Most support 1.16+ up to the latest version. Each plugin shows its compatibility on the card.',
      'faq.q3': 'Is there support?',
      'faq.a3': '24/7 support on our Discord and via email. Average response time is 2 hours.',
      'faq.q4': 'Can I use on multiple servers?',
      'faq.a4': 'Standard license covers 1 server. For multi-server, contact us — we have special plans.',
      
      // Affiliates
      'aff.title': 'Refer and <span class="grad-word">earn</span>',
      'aff.subtitle': 'Have friends with Minecraft servers? Refer our plugins and earn <strong>25% commission</strong> on every sale — forever.',
      'aff.stats.commission': '25% commission',
      'aff.stats.cookie': '30-day cookie',
      'aff.stats.payment': 'Monthly payment',
      'aff.stats.unlimited': 'Unlimited referrals',
      'aff.how.title': 'How it works',
      'aff.how.step1.title': 'Create your account',
      'aff.how.step1.desc': 'Open the <strong>Dashboard</strong> at the top, sign up and enable the affiliate program in your account.',
      'aff.how.step2.title': 'Share',
      'aff.how.step2.desc': 'Use your unique code and link — available in your dashboard — in videos, Discord and social media.',
      'aff.how.step3.title': 'Earn',
      'aff.how.step3.desc': 'For every purchase made with your code, you earn 25%. Track everything and request withdrawal through the dashboard.',
      'aff.cta.title': 'Affiliate Program',
      'aff.cta.desc': 'Affiliate registration and management is done inside your dashboard, along with your purchases and data.',
      'aff.cta.button': 'Open Dashboard',
      'aff.cta.note': 'If you\'re new here, click <strong>Sign Up</strong> inside the dashboard.',
      
      // Footer
      'footer.tagline': 'Premium plugins for Minecraft servers. Made by players, for players.',
      'footer.shop': 'Shop',
      'footer.support': 'Support',
      'footer.company': 'Company',
      'footer.discord': 'Discord',
      'footer.docs': 'Documentation',
      'footer.contact': 'Contact',
      'footer.about': 'About',
      'footer.terms': 'Terms',
      'footer.privacy': 'Privacy',
      'footer.copyright': '© 2026 cafe · plugins. Not affiliated with Mojang AB.',
      
      // Cart
      'cart.title': 'Cart',
      'cart.empty': 'Your cart is empty',
      'cart.total': 'Total',
      'cart.checkout': 'Checkout',
      'cart.remove': 'Remove',
      
      // Checkout
      'checkout.title': 'Checkout',
      'checkout.desc': 'Fill in your details. After confirmation, you\'ll receive the download link by email.',
      'checkout.name': 'Name',
      'checkout.name_placeholder': 'Your name',
      'checkout.email': 'Email',
      'checkout.email_placeholder': 'you@email.com',
      'checkout.payment': 'Payment method',
      'checkout.payment.pix': 'Pix (instant payment)',
      'checkout.payment.card': 'Credit card (up to 12x)',
      'checkout.payment.boleto': 'Boleto',
      'checkout.affiliate': 'Affiliate code (optional)',
      'checkout.affiliate_placeholder': 'Ex: JOAO42',
      'checkout.confirm': 'Confirm payment',
      'checkout.payment.note': 'Transparent Pix and credit card via secure Mercado Pago or AbacatePay checkout.',

      // Payment methods
      'payment.pix.title': 'Pay with Pix',
      'payment.pix.expires': 'Expires in',
      'payment.pix.expired': 'PIX expired',
      'payment.pix.waiting': 'Waiting for payment…',
      'payment.pix.paid': 'Paid! License unlocked.',
      'payment.pix.copy': 'Copy code',
      'payment.pix.copied': 'PIX code copied',
      'payment.pix.failed': 'Order created, but the PIX charge failed. Use the "View my account" link to try again.',
      'payment.card.redirect': 'Redirecting to credit card payment...',
      'payment.card.unavailable': 'Credit card payment unavailable. Try again or use Pix.',

      // Auth
      'auth.login': 'Sign In',
      'auth.register': 'Sign Up',
      'auth.logout': 'Sign Out',
      'auth.login_required': 'Please log in to continue your purchase',
      'auth.email': 'Email',
      'auth.password': 'Password',
      'auth.forgot': 'Forgot password',
      'auth.no_account': 'No account? Sign Up',
      'auth.has_account': 'Already have an account? Sign In',
      'auth.recover': 'Recover password',
      'auth.verify_email': 'Verify your email',
      'auth.code_sent': 'Code sent',
      'auth.code_placeholder': '000000',
      'auth.send_code': 'Send code',
      'auth.validate_code': 'Validate code',
      'auth.new_password': 'New password',
      'auth.confirm_password': 'Confirm new password',
      'auth.save_password': 'Save new password',
      'auth.back': 'Back',
      'auth.resend': 'Resend code',
      
      // Account
      'account.title': 'My Account',
      'account.orders': 'My Purchases',
      'account.affiliate': 'Affiliate',
      'account.settings': 'Settings',
      'account.no_orders': 'You haven\'t made any purchases yet',
      'account.view_downloads': 'View my downloads',
      'account.view_pix_qr': 'View Pix QR',
      'account.create_password': 'Create password and access',

      // Toasts
      'toast.added_cart': 'Added to cart',
      'toast.removed_cart': 'Removed from cart',
      'toast.invalid_email': 'Invalid email',
      'toast.fill_name_email': 'Please fill in name and email',
      'toast.invalid_affiliate': 'Invalid affiliate code',
      'toast.own_code': 'You cannot use your own affiliate code',
      'toast.order_created': 'Order created!',
      'toast.payment_confirmed': 'Payment confirmed! Your plugins are unlocked.',
      'toast.download_started': 'Download started',
      
      // Language selector
      'lang.select': 'Language',
      'lang.pt-BR': 'Português (BR)',
      'lang.pt-PT': 'Português (PT)',
      'lang.en': 'English',
      'lang.es': 'Español'
    },
    
    'es': {
      // Navbar
      'nav.plugins': 'Plugins',
      'nav.how_it_works': 'Cómo funciona',
      'nav.affiliates': 'Afiliados',
      'nav.faq': 'FAQ',
      'nav.panel': 'Panel',
      'nav.cart': 'Carrito',
      
      // Hero
      'hero.eyebrow': 'Tienda de plugins para Minecraft',
      'hero.title': 'Plugins premium para tu servidor de Minecraft.',
      'hero.lead': 'Plugins listos, bien documentados y con soporte real. PvP, economía, facciones, lobby y mucho más — todo lo que necesitas para un servidor que los jugadores no querrán dejar.',
      'hero.cta_primary': 'Ver plugins',
      'hero.cta_secondary': 'Cómo funciona',
      'hero.stats.downloads': 'descargas',
      'hero.stats.rating': 'valoración media',
      'hero.stats.support': 'Soporte',
      
      // Catalog
      'catalog.title': 'Plugins',
      'catalog.subtitle': 'Todo lo que necesitas para personalizar tu servidor.',
      'filters.all': 'Todos',
      'filters.free': 'Gratis',
      'filters.paid': 'De pago',
      
      // How it works
      'hiw.title': 'Cómo funciona',
      'hiw.subtitle': 'En 3 minutos tu servidor estará como nuevo.',
      'hiw.step1.title': 'Elige el plugin',
      'hiw.step1.desc': 'Mira demos, versiones y reseñas antes de comprar.',
      'hiw.step2.title': 'Paga seguro',
      'hiw.step2.desc': 'Pix y tarjeta. Recibe el enlace de descarga al instante.',
      'hiw.step3.title': 'Instala y juega',
      'hiw.step3.desc': 'Coloca el .jar en /plugins, reinicia y disfruta.',
      
      // FAQ
      'faq.title': 'Preguntas frecuentes',
      'faq.q1': '¿Los plugins reciben actualizaciones?',
      'faq.a1': 'Sí. Todas las compras incluyen 1 año de actualizaciones. Puedes renovar con 50% de descuento.',
      'faq.q2': '¿Qué versión de Minecraft es compatible?',
      'faq.a2': 'La mayoría soporta 1.16+ hasta la versión más reciente. Cada plugin muestra su compatibilidad en la tarjeta.',
      'faq.q3': '¿Hay soporte?',
      'faq.a3': 'Soporte 24/7 en nuestro Discord y por email. Tiempo medio de respuesta: 2 horas.',
      'faq.q4': '¿Puedo usar en varios servidores?',
      'faq.a4': 'La licencia estándar cubre 1 servidor. Para multi-servidor, contáctanos — tenemos planes especiales.',
      
      // Affiliates
      'aff.title': 'Refiere y <span class="grad-word">gana</span>',
      'aff.subtitle': '¿Tienes amigos con servidores de Minecraft? Refiere nuestros plugins y gana <strong>25% de comisión</strong> en cada venta — para siempre.',
      'aff.stats.commission': '25% de comisión',
      'aff.stats.cookie': 'Cookie de 30 días',
      'aff.stats.payment': 'Pago mensual',
      'aff.stats.unlimited': 'Referidos ilimitados',
      'aff.how.title': 'Cómo funciona',
      'aff.how.step1.title': 'Crea tu cuenta',
      'aff.how.step1.desc': 'Abre el <strong>Panel</strong> en la parte superior, regístrate y activa el programa de afiliados en tu cuenta.',
      'aff.how.step2.title': 'Comparte',
      'aff.how.step2.desc': 'Usa tu código y enlace exclusivos — disponibles en tu panel — en videos, Discord y redes sociales.',
      'aff.how.step3.title': 'Gana',
      'aff.how.step3.desc': 'Por cada compra hecha con tu código, ganas 25%. Sigue todo y solicita el retiro desde el panel.',
      'aff.cta.title': 'Programa de Afiliados',
      'aff.cta.desc': 'El registro y gestión de afiliados se hace dentro de tu panel, junto con tus compras y datos.',
      'aff.cta.button': 'Abrir Panel',
      'aff.cta.note': 'Si eres nuevo aquí, haz clic en <strong>Registrarse</strong> dentro del panel.',
      
      // Footer
      'footer.tagline': 'Plugins premium para servidores de Minecraft. Hecho por jugadores, para jugadores.',
      'footer.shop': 'Tienda',
      'footer.support': 'Soporte',
      'footer.company': 'Empresa',
      'footer.discord': 'Discord',
      'footer.docs': 'Documentación',
      'footer.contact': 'Contacto',
      'footer.about': 'Acerca de',
      'footer.terms': 'Términos',
      'footer.privacy': 'Privacidad',
      'footer.copyright': '© 2026 cafe · plugins. No afiliado a Mojang AB.',
      
      // Cart
      'cart.title': 'Carrito',
      'cart.empty': 'Tu carrito está vacío',
      'cart.total': 'Total',
      'cart.checkout': 'Finalizar compra',
      'cart.remove': 'Eliminar',
      
      // Checkout
      'checkout.title': 'Finalizar compra',
      'checkout.desc': 'Completa tus datos. Después de la confirmación, recibirás el enlace de descarga por email.',
      'checkout.name': 'Nombre',
      'checkout.name_placeholder': 'Tu nombre',
      'checkout.email': 'Email',
      'checkout.email_placeholder': 'tu@email.com',
      'checkout.payment': 'Método de pago',
      'checkout.payment.pix': 'Pix (pago instantáneo)',
      'checkout.payment.card': 'Tarjeta de crédito (hasta 12x)',
      'checkout.payment.boleto': 'Boleto',
      'checkout.affiliate': 'Código de afiliado (opcional)',
      'checkout.affiliate_placeholder': 'Ej: JOAO42',
      'checkout.confirm': 'Confirmar pago',
      'checkout.payment.note': 'Pix transparente y tarjeta vía checkout seguro de Mercado Pago o AbacatePay.',

      // Payment methods
      'payment.pix.title': 'Pagar con Pix',
      'payment.pix.expires': 'Expira en',
      'payment.pix.expired': 'PIX expirado',
      'payment.pix.waiting': 'Esperando pago…',
      'payment.pix.paid': '¡Pagado! Licencia desbloqueada.',
      'payment.pix.copy': 'Copiar código',
      'payment.pix.copied': 'Código PIX copiado',
      'payment.pix.failed': 'Pedido creado, pero el cobro de Pix falló. Usa el enlace "Ver mi cuenta" para intentar de nuevo.',
      'payment.card.redirect': 'Redirigiendo al pago con tarjeta...',
      'payment.card.unavailable': 'Pago con tarjeta no disponible. Inténtalo de nuevo o usa Pix.',

      // Auth
      'auth.login': 'Iniciar sesión',
      'auth.register': 'Registrarse',
      'auth.logout': 'Cerrar sesión',
      'auth.login_required': 'Inicia sesión para continuar tu compra',
      'auth.email': 'Email',
      'auth.password': 'Contraseña',
      'auth.forgot': 'Olvidé mi contraseña',
      'auth.no_account': '¿No tienes cuenta? Regístrate',
      'auth.has_account': '¿Ya tienes cuenta? Inicia sesión',
      'auth.recover': 'Recuperar contraseña',
      'auth.verify_email': 'Verifica tu email',
      'auth.code_sent': 'Código enviado',
      'auth.code_placeholder': '000000',
      'auth.send_code': 'Enviar código',
      'auth.validate_code': 'Validar código',
      'auth.new_password': 'Nueva contraseña',
      'auth.confirm_password': 'Confirmar nueva contraseña',
      'auth.save_password': 'Guardar nueva contraseña',
      'auth.back': 'Volver',
      'auth.resend': 'Reenviar código',
      
      // Account
      'account.title': 'Mi Cuenta',
      'account.orders': 'Mis Compras',
      'account.affiliate': 'Afiliado',
      'account.settings': 'Configuración',
      'account.no_orders': 'Aún no has hecho compras',
      'account.view_downloads': 'Ver mis descargas',
      'account.view_pix_qr': 'Ver QR de Pix',
      'account.create_password': 'Crear contraseña y acceder',

      // Toasts
      'toast.added_cart': 'Añadido al carrito',
      'toast.removed_cart': 'Eliminado del carrito',
      'toast.invalid_email': 'Email inválido',
      'toast.fill_name_email': 'Completa nombre y email',
      'toast.invalid_affiliate': 'Código de afiliado inválido',
      'toast.own_code': 'No puedes usar tu propio código de afiliado',
      'toast.order_created': '¡Pedido creado!',
      'toast.payment_confirmed': '¡Pago confirmado! Tus plugins están desbloqueados.',
      'toast.download_started': 'Descarga iniciada',
      
      // Language selector
      'lang.select': 'Idioma',
      'lang.pt-BR': 'Português (BR)',
      'lang.pt-PT': 'Português (PT)',
      'lang.en': 'English',
      'lang.es': 'Español'
    }
  },
  
  // Inicializa o i18n
  init() {
    const saved = localStorage.getItem('cafe_locale');
    const browserLang = navigator.language || navigator.userLanguage;
    const preferred = saved || this.getLocaleFromURL() || (this.supportsLocale(browserLang) ? browserLang : this.defaultLocale);
    this.setLocale(preferred);
  },
  
  // Verifica se locale é suportado
  supportsLocale(locale) {
    if (!locale) return false;
    const base = locale.split('-')[0].toLowerCase();
    const supported = ['pt-br', 'pt-pt', 'en', 'es'];
    return supported.includes(locale.toLowerCase()) || supported.includes(base);
  },
  
  // Normaliza locale
  normalizeLocale(locale) {
    if (!locale) return this.defaultLocale;
    const parts = locale.toLowerCase().split('-');
    const lang = parts[0];
    const region = parts[1] || '';
    
    if (lang === 'pt') {
      return region === 'pt' ? 'pt-PT' : 'pt-BR';
    }
    if (lang === 'en') return 'en';
    if (lang === 'es') return 'es';
    
    return this.defaultLocale;
  },
  
  // Obtém locale da URL (?lang=pt-BR)
  getLocaleFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('lang');
  },
  
  // Define locale atual
  setLocale(locale) {
    this.currentLocale = this.normalizeLocale(locale);
    localStorage.setItem('cafe_locale', this.currentLocale);
    this.updateURL();
    this.applyTranslations();
    this.updateLangSelector();
    document.documentElement.lang = this.currentLocale;
  },
  
  // Atualiza URL com parâmetro lang
  updateURL() {
    const url = new URL(window.location);
    url.searchParams.set('lang', this.currentLocale);
    window.history.replaceState({}, '', url);
  },
  
  // Traduz uma chave
  t(key, params = {}) {
    let text = this.translations[this.currentLocale]?.[key] || 
               this.translations[this.defaultLocale]?.[key] || 
               key;
    
    // Substitui parâmetros {{param}}
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    });
    
    return text;
  },
  
  // Aplica traduções ao DOM
  applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const params = {};
      
      // Obtém parâmetros data-i18n-param-*
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('data-i18n-param-')) {
          const paramName = attr.name.replace('data-i18n-param-', '');
          params[paramName] = attr.value;
        }
      });
      
      el.innerHTML = this.t(key, params);
    });
    
    // Atualiza placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = this.t(key);
    });
    
    // Atualiza títulos/aria-labels
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      el.title = this.t(key);
    });
    
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      el.setAttribute('aria-label', this.t(key));
    });
    
    // Dispara evento customizado
    window.dispatchEvent(new CustomEvent('i18n:updated', { detail: { locale: this.currentLocale } }));
  },
  
  // Atualiza seletor de idioma
  updateLangSelector() {
    document.querySelectorAll('[data-lang-selector]').forEach(el => {
      const lang = el.getAttribute('data-lang-selector');
      el.classList.toggle('active', lang === this.currentLocale);
    });
    
    // Atualiza texto do botão atual
    const currentText = document.querySelector('[data-i18n="lang.current"]');
    if (currentText) {
      currentText.textContent = this.t(`lang.${this.currentLocale}`);
    }
  },
  
  // Formata moeda
  formatCurrency(value, locale) {
    const loc = locale || this.currentLocale;
    const currencyMap = {
      'pt-BR': { currency: 'BRL', locale: 'pt-BR' },
      'pt-PT': { currency: 'EUR', locale: 'pt-PT' },
      'en': { currency: 'USD', locale: 'en-US' },
      'es': { currency: 'USD', locale: 'es-US' }
    };
    
    const config = currencyMap[loc] || currencyMap['pt-BR'];
    return new Intl.NumberFormat(config.locale, {
      style: 'currency',
      currency: config.currency
    }).format(value);
  }
};

// Exporta para uso global
window.I18N = I18N;

// Auto-inicializa quando DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => I18N.init());
} else {
  I18N.init();
}
