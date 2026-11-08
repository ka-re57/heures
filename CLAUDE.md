# Appli heures KA-RÉ

Appli de pointage, congés et préparation de paie de la SARL KA-RÉ (Rémi KATA).
Publiée sur GitHub Pages : https://ka-re57.github.io/heures/

## Règles de travail

- Cahier des charges : Claude Doc « Appli heures et paie KA-RÉ — cahier des charges »
  (claude.ai/artifact/WVJjgCcai39AaYjQgs4QEj). Il fait foi.
- Données : Notion, page « Heures et paie KA-RÉ » (410691f4-100e-8127-86c0-c22bc98c959e),
  bases Salariés, Heures, Congés et absences, Paramètres paie. L'appli n'y accède que par
  des webhooks Make.
- Montants de paie (SMIC, panier, trajets) : jamais en dur dans le code, toujours lus dans
  la base Paramètres paie, avec leur date d'effet.
- Publication : push sur `main`, après validation de Rémi. Ne jamais casser une version
  installée : tester avant (navigateur, données fictives).
- Les réponses de Make en tableau peuvent arriver sous la forme {"bundle":{}} :
  toujours normaliser côté appli.
