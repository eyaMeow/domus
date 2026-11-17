const supportEmail = 'chihieya59@gmail.com';
const effectiveDate = '16 novembre 2026';

const page = (title, body) => `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Domus</title>
  <style>
    body{font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif;color:#17243d;background:#f6f8f9;margin:0}
    main{max-width:760px;margin:40px auto;padding:32px;background:#fff;border-radius:16px}
    h1,h2{line-height:1.25}h1{color:#128078}a{color:#0a6863}
    nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px}
    @media(max-width:600px){main{margin:0;padding:24px 18px;border-radius:0}}
  </style>
</head>
<body>
<main>
  <nav aria-label="Pages légales">
    <a href="/privacy-policy">Confidentialité</a>
    <a href="/terms-of-use">Conditions d’utilisation</a>
    <a href="/account-deletion">Suppression du compte</a>
  </nav>
  <h1>${title}</h1>
  <p><strong>Application :</strong> Domus · <strong>Éditeur :</strong> Noxel · <strong>Date d’effet :</strong> ${effectiveDate}</p>
  ${body}
  <p>Contact : <a href="mailto:${supportEmail}">${supportEmail}</a></p>
</main>
</body>
</html>`;

export const legalPages = {
  '/privacy-policy': page('Politique de confidentialité', `
    <p>Domus est un service de recherche, de publication et de discussion autour d’annonces immobilières.</p>
    <h2>Données traitées</h2>
    <p>Nous traitons votre nom, votre adresse e-mail, votre mot de passe sous forme de hachage sécurisé et, si vous les fournissez, votre téléphone, votre ville et les informations de votre profil. Le service traite aussi les annonces, photos, prix, villes et emplacements choisis par les propriétaires, vos favoris, les messages, ainsi que les signalements et blocages nécessaires à la sécurité.</p>
    <h2>Utilisation et visibilité</h2>
    <p>Ces données servent à créer et sécuriser les comptes, afficher et rechercher des annonces, enregistrer les favoris, permettre les conversations et modérer les contenus signalés. Les annonces, photos et emplacements publiés sont visibles par les utilisateurs. Les messages sont accessibles aux participants de la conversation; les signalements sont accessibles aux administrateurs chargés de leur examen.</p>
    <h2>Fournisseurs et partage</h2>
    <p>L’API est hébergée sur Render. La base de données et le stockage des photos utilisent Supabase. Les courriels de vérification et de réinitialisation sont envoyés par le service SMTP configuré par Domus. Les cartes utilisent MapLibre et les tuiles OpenFreeMap; ces requêtes peuvent communiquer au fournisseur votre adresse IP et la zone cartographique demandée.</p>
    <h2>Localisation</h2>
    <p>Si vous choisissez la fonction de localisation et accordez l’autorisation, Domus utilise la position de l’appareil pour centrer la carte et calculer les distances sur l’appareil. Cette position n’est pas enregistrée dans votre compte ni envoyée à l’API Domus. Les emplacements d’annonces sont fournis séparément par leurs propriétaires et peuvent être affichés aux utilisateurs.</p>
    <h2>Conservation et suppression</h2>
    <p>Les données du compte sont conservées tant que le compte existe. Vous pouvez supprimer votre compte depuis l’application ou demander sa suppression à l’adresse de contact indiquée ci-dessus. La suppression retire le profil, les annonces et les données associées selon le fonctionnement du service. Certaines informations peuvent être conservées lorsque la loi l’exige ou pour traiter un litige ou un abus.</p>
    <h2>Choix et contact</h2>
    <p>Vous pouvez modifier les informations de profil fournies et désactiver l’accès à la localisation dans les réglages de l’appareil. Pour toute question ou demande relative à vos données, contactez le support Domus depuis l’adresse e-mail associée à votre compte.</p>
  `),
  '/terms-of-use': page('Conditions d’utilisation', `
    <p>En créant un compte ou en utilisant Domus, vous acceptez ces conditions. Domus permet de rechercher, publier et discuter au sujet de biens immobiliers.</p>
    <h2>Comptes et annonces</h2>
    <p>Vous devez fournir des informations exactes et protéger vos identifiants. Vous ne pouvez publier que des annonces et photos que vous êtes autorisé à partager. Les informations sur le prix, le bien, son emplacement et sa disponibilité doivent être sincères et ne pas enfreindre les droits d’autrui.</p>
    <h2>Conduite et modération</h2>
    <p>Il est interdit d’utiliser Domus pour frauder, harceler, envoyer des messages abusifs ou non sollicités, publier des contenus illégaux ou accéder au compte d’une autre personne. Vous pouvez signaler une annonce ou un utilisateur et bloquer un utilisateur depuis une conversation. Domus peut examiner les signalements, retirer des contenus et suspendre les comptes qui enfreignent ces conditions ou la loi.</p>
    <h2>Transactions immobilières</h2>
    <p>Les utilisateurs doivent vérifier indépendamment l’identité des interlocuteurs, la propriété, les documents et les conditions d’une transaction. Domus ne détient pas les paiements, ne garantit pas les annonces et n’est pas partie aux transactions entre utilisateurs.</p>
    <h2>Suppression du compte</h2>
    <p>Vous pouvez supprimer votre compte depuis l’application ou demander sa suppression via la page <a href="/account-deletion">Suppression du compte</a>. La suppression du compte peut rendre indisponibles les annonces et conversations associées.</p>
  `),
  '/account-deletion': page('Demander la suppression du compte', `
    <p>Vous pouvez supprimer votre compte Domus depuis l’application : ouvrez votre profil, choisissez « Supprimer mon compte » et confirmez la demande.</p>
    <p>Si vous ne pouvez pas accéder à l’application, envoyez un e-mail au support Domus depuis l’adresse associée à votre compte. Indiquez « Suppression du compte Domus » dans l’objet. Si vous écrivez depuis une autre adresse, indiquez l’adresse e-mail du compte afin que nous puissions vérifier la demande.</p>
    <p>La suppression retire le profil, les annonces, favoris, conversations et données associées selon le fonctionnement du service. Les photos liées à des annonces supprimées sont retirées lorsqu’elles ne sont plus utilisées. Certaines informations peuvent être conservées lorsque la loi l’exige ou pour traiter un litige ou un abus.</p>
    <p><a href="mailto:${supportEmail}?subject=Suppression%20du%20compte%20Domus">Envoyer une demande de suppression par e-mail</a></p>
  `),
};
