// Liste par défaut des indicateurs FARS (canevas « Revue de la qualité des données — Situation des indicateurs de
// performance »), avec les cibles du canevas. Les UID ont été retrouvés dans le DHIS2 Sénégal par le nom de
// l'indicateur ; uid = null quand aucun indicateur DHIS2 correspondant n'a été trouvé (la ligne s'affiche alors
// « à associer » et l'utilisateur peut choisir l'indicateur DHIS2 lui-même). sens = "bas" quand une valeur plus
// faible est meilleure (la cible est un maximum).
// Chaque utilisateur peut ensuite ajouter ou retirer des indicateurs ; ce choix est gardé dans son navigateur.
export const FARS_DEFAUT = [
  // Santé de la reproduction, maternelle, néonatale, infantile et adolescente & Nutrition
  ["SRMNIA_Nut", "v25hqA8G2z1", "Nombre d'actives PF chez toutes les femmes", null],
  ["SRMNIA_Nut", "fKZVYXe2Lf3", "Taux de recrutement PF", 9],
  ["SRMNIA_Nut", "Vu0IMjKsIfi", "Pourcentage de femmes sous méthode contraceptive après avortement", 59],
  ["SRMNIA_Nut", "kogf4a2x2h5", "Taux de MAS déchargé du CREN (traité avec succès)", 60],
  ["SRMNIA_Nut", "TOpxOeqUFUY", "Taux de guérison des enfants de 6-59 mois MAS à l'UREN", 80],
  ["SRMNIA_Nut", "l27lg2BdVQw", "Pourcentage d'enfants de 12-59 mois supplémentés en vitamine A en routine", 65],
  ["SRMNIA_Nut", "uANT2r2VE6m", "Pourcentage d'enfants de 0-59 mois présentant une pneumonie simple et traitée avec un antibiotique approprié (Amoxicilline)", 100],
  ["SRMNIA_Nut", "VXWRJsy0Yyk", "Proportion de cas de diarrhée chez les enfants 0-59 mois traités par SRO/ZINC", 100],
  ["SRMNIA_Nut", "IsyZ7w8Qco2", "Taux de couverture en CPN1", 63],
  ["SRMNIA_Nut", "Z2DHIx1TK8A", "Taux d'accouchements effectués dans les structures sanitaires (EPS, CS et PS)", 93.5],
  ["SRMNIA_Nut", "AmB46sMywvM", "Pourcentage de césarienne", 7.3],
  ["SRMNIA_Nut", "xInrxfOM02e", "Pourcentage de décès maternels audités", 85.9],
  ["SRMNIA_Nut", "hePGrjQhwNi", "Pourcentage de décès néonatals audités", 40],
  // Canevas : 20 ‰. L'indicateur DHIS2 est en pourcentage : 20 ‰ = 2 %.
  ["SRMNIA_Nut", "E437FtdQcoJ", "Taux de mortinaissance (%, cible 20 ‰)", 2, "bas"],
  ["SRMNIA_Nut", "K8Hp7UXPny5", "Taux de couverture en CPoN", 53],
  ["SRMNIA_Nut", null, "Proportion de structures sanitaires (CS/PS) disposant d'espace ado-jeune", 41.6],
  // Paludisme
  ["Paludisme", "i8fSrdmJYQA", "Cas suspects de paludisme ayant reçu un test parasitologique (formations sanitaires et communautaires), tout âge", 100],
  ["Paludisme", "mk2ZvXCBs31", "Cas confirmés traités selon la politique nationale via la PECADOM", 100],
  ["Paludisme", "p0RtfpG8X5u", "Cas vus en consultation externe traités selon la politique nationale, tout âge", 100],
  ["Paludisme", "lDS5UfSbPRj", "Femmes enceintes ayant bénéficié de la SP3 (TPI 3)", 80],
  ["Paludisme", "Mnnz4cJyRjw", "Femmes enceintes vues en CPN1 ayant reçu une MILDA de routine", 100],
  // Tuberculose et VIH
  ["Tuberculose", "LYLULRnF4KG", "Taux de couverture thérapeutique", 68],
  ["Tuberculose", "KmyYP1t3GKG", "Taux de décès", 2, "bas"],
  ["Tuberculose", "zYZAorcDa8i", "Taux de réalisation du test VIH chez les TB", 100],
  // Programme élargi de vaccination
  ["PEV", "ZKY766cfbue", "Couverture Hep inf 24 H", 90],
  ["PEV", "XmJ0fe8aLCx", "Couverture Hexa 1", 90],
  ["PEV", "gGB1agUWvWF", "Couverture Hexa 3", 90],
  ["PEV", "dX5qyax6WpF", "Couverture RR 1", 90],
  ["PEV", "t6ZBHlqBGCb", "Couverture RR 2", 90],
  // Santé communautaire (DHIS2 ne contient que les nombres de cas traités, pas les proportions)
  ["Santé com.", null, "Proportion de cas de diarrhée (2-59 mois) sans déshydratation traités par SRO/Zinc", 100],
  ["Santé com.", null, "Proportion de cas de pneumonie (2-59 mois) traités par amoxicilline", 100],
  ["Santé com.", null, "Proportion de cas de paludisme (2-59 mois) traités par ACT (cas correctement pris en charge)", 100],
  // Maladies non transmissibles
  ["MNT", "ExXXn2Uqhqa", "Taux de dépistage de l'HTA", 15],
  ["MNT", "Zpj1cTyGthI", "Taux de dépistage du diabète", 5],
  ["MNT", "H7SmG0nAHsD", "Taux de dépistage des lésions précancéreuses du col de l'utérus", 20],
  ["MNT", "c7lef00c2g0", "Proportion de femmes ayant bénéficié d'un traitement des lésions précancéreuses", 70],
  ["MNT", null, "Nombre d'unités de PEC des AVC mis en place dans les EPS", 1],
  ["MNT", null, "Nombre de centres de réadaptation cardiaque mis en place dans les EPS", 1],
  // Maladies tropicales négligées
  ["MTN", null, "Taux de complétude globale des formulaires MTN dans le DHIS2", 90],
  ["MTN", "rCuvzQUIGW7", "Proportion d'enfants de moins de 15 ans parmi les nouveaux cas de lèpre", 10, "bas"],
  ["MTN", "Vf5S0vZo4gD", "Pourcentage de cas de morsure de serpent pris en charge avec sérum antivenimeux", 90],
  ["MTN", "npGe7sSA9H8", "Proportion de personnes exposées à la rage et prise en charge", 90],
  ["MTN", "B3pNkK9hREe", "Proportion de cas suspects de bilharzioses (urinaire + intestinale) traités", 90],
  ["MTN", "zVKOgWvxetB", "Proportion de cas suspects de géohelminthiases pris en charge", 90],
].map(([programme, uid, nom, cible, sens = "haut"], ordre) => ({ id: uid || `a-associer-${ordre}`, uid, nom, programme, cible, sens }));

export const PROGRAMMES_ORDRE = ["SRMNIA_Nut", "Paludisme", "Tuberculose", "VIH", "PEV", "Santé com.", "MNT", "MTN"];

// Formulaires suivis par défaut dans « Qualité des données » : ceux de l'extraction hebdomadaire de complétude.
export const FORMULAIRES_DEFAUT = [
  ["M4ljv368987", "MTN : Prise en Charge cas par cas"],
  ["EQpGvknJuwC", "MTN : Rapport Mensuel Centre de santé & EPS"],
  ["iOmcvd5ISa9", "MTN : Rapport Mensuel PS"],
  ["jMafzX3zJar", "PEV : Rapport mensuel de vaccination par stratégie"],
  ["KIDscTynoEx", "Paludisme : Rapport mensuel Centre de Santé"],
  ["RHIwLuXCW6k", "Paludisme : Rapport mensuel EPS"],
  ["BRPTBLnqZ0T", "Paludisme : Rapport mensuel Poste de Santé"],
  ["nRwgOybg4EA", "R20 Planification Familiale"],
  ["L4BbguC3TYl", "R20 Prévention et Prise en Charge Maladie - PS"],
  ["yFMwCXlmAfi", "R20 Prévention et Prise en Charge de la Maladie - CS"],
  ["bqzApqASIrN", "R20 Rapport Global : Morbidité et Mortalité du CS"],
  ["YJNd0kNybBM", "R20 Rapport Global : Morbidité et Mortalité du PS"],
  ["ovoiyZctyyY", "R20 Santé de la mère et du nouveau-né"],
  ["uxf4p87mmD1", "R20 Santé de l’enfant"],
  ["i9RUJFTXQOS", "R21 VIH Rapport Mensuel PTME Poste de Santé"],
  ["ZIvhWhBfnHz", "R21 VIH Rapport PTME EPS et CS"],
  ["jhY9VxBMD2Y", "R21 VIH Rapport mensuel PEC Poste"],
  ["MuKRzBZvvLY", "R22 Santé Bucco-dentaire : Rapport Mensuel"],
  ["HuNS5xd2VnR", "R24 VIH Notification syndromique des IST et syphilis"],
  ["J04dJ4BDY3h", "R24 VIH Rapport mensuel Laboratoire"],
].map(([uid, nom], ordre) => ({ uid, nom, ordre }));
