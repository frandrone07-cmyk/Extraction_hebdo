# Déclenchement manuel protégé

Le site est servi par GitHub Pages et ne peut pas conserver un jeton GitHub en sécurité dans le navigateur. Le bouton de lancement appelle donc un Cloudflare Worker : le Worker vérifie le PIN, applique une limite de tentatives et appelle le workflow `extraction.yml`. Les secrets DHIS2 restent uniquement dans les secrets GitHub Actions.

## Mise en service Cloudflare

1. Créer un jeton d’accès finement ciblé sur le dépôt `frandrone07-cmyk/Extraction_hebdo`, avec les permissions **Actions: Read and write**. Conserver le jeton dans un gestionnaire de secrets.
2. Dans un terminal local, depuis la racine du dépôt, lancer `python trigger-worker/generer_secrets.py`. Le PIN est saisi sans affichage ; le script ne révèle que `PIN_SALT` et `PIN_HASH`.
3. Installer Wrangler 4.36 ou plus récent et se connecter au compte Cloudflare : `npx wrangler@latest login`.
4. Depuis `trigger-worker/`, déposer les secrets de manière interactive :

   ```text
   npx wrangler@latest secret put GITHUB_TOKEN
   npx wrangler@latest secret put PIN_SALT
   npx wrangler@latest secret put PIN_HASH
   ```

   Wrangler demande la valeur directement dans le terminal. Ne la coller ni dans un fichier du dépôt ni dans le navigateur.
5. Déployer le Worker : `npx wrangler@latest deploy`. Noter l’URL `*.workers.dev` affichée.
6. Copier cette URL dans `TRIGGER_API_URL` de `web/src/trigger-config.js`, puis committer et pousser la modification pour redéployer GitHub Pages.

Le Worker n’accepte que l’origine `https://frandrone07-cmyk.github.io`, ne conserve pas le PIN reçu, compare un hash salé en temps constant, et limite les appels à cinq par minute et par adresse IP au niveau de chaque point de présence Cloudflare. Cette limite Cloudflare est une protection approximative distribuée, pas un compteur mondial strict. Renouveler le jeton GitHub si des personnes autorisées à le créer ou à le consulter quittent l’équipe.

Après configuration, le bouton **Lancer l’extraction** demande le PIN et la fenêtre de mois, puis suit l’exécution GitHub Actions. Le mois courant devient disponible le 15 : avant cette date, la période la plus récente est le mois précédent. Pour un gabarit sans périodes, la fenêtre par défaut est celle de `config/config.yml` (les trois dernières périodes disponibles). Avec des périodes dans le gabarit, l’extraction les conserve et complète les mois manquants jusqu’à la dernière période disponible.
