#!/usr/bin/env bash
#
# Rapatrier le travail de flowtricks/stacki dans ce fork.
#
#   ./sync-upstream.sh            — voir ce qui est nouveau, sans rien changer
#   ./sync-upstream.sh --merge    — fusionner upstream/main, puis lancer les tests
#
# Ce fichier n'existe pas en amont, donc il ne peut jamais entrer en conflit.
# C'est la règle qui garde les rapatriements bon marché : ce qui t'appartient
# vit dans des fichiers que l'amont ne touche pas.

set -euo pipefail
cd "$(dirname "$0")"

MERGE=false
[ "${1:-}" = "--merge" ] && MERGE=true

echo "→ Récupération de l'amont…"
git fetch upstream main --quiet
git fetch upstream '+refs/pull/*/head:refs/remotes/upstream/pr/*' --quiet

NEW=$(git rev-list --count HEAD..upstream/main)
MINE=$(git rev-list --count upstream/main..HEAD)

echo
echo "Commits en amont que tu n'as pas : $NEW"
echo "Commits à toi que l'amont n'a pas : $MINE"

if [ "$NEW" -gt 0 ]; then
  echo
  echo "--- nouveautés amont ---"
  git log --oneline HEAD..upstream/main
fi

# Les PR encore ouvertes en amont, dont celles déjà fusionnées ici.
echo
echo "--- PR ouvertes en amont ---"
OPEN=$(curl -sf "https://api.github.com/repos/flowtricks/stacki/pulls?state=open&per_page=50" \
  | python3 -c "
import sys, json
for p in sorted(json.load(sys.stdin), key=lambda x: x['number']):
    print(p['number'], p['user']['login'], p['title'][:58], sep='\t')
" 2>/dev/null) || OPEN=""

if [ -z "$OPEN" ]; then
  echo "  (GitHub injoignable — passe)"
else
  HEAD_TREE=$(git rev-parse 'HEAD^{tree}')
  while IFS=$'\t' read -r num author title; do
    [ -z "$num" ] && continue
    # Une PR n'apporte plus rien dès que les commits qu'elle a écrits sont
    # tous chez nous — ses commits de fusion ne comptent pas, ils ne portent
    # rien. C'est le cas de #20, dont l'unique commit est arrivé par #21 :
    # la fusionner conflicterait, alors que son contenu est déjà là.
    if [ -z "$(git rev-list "upstream/pr/$num" --not HEAD --no-merges 2>/dev/null)" ]; then
      state="deja-dedans"
    # Sinon, fusionner pour de faux et regarder l'arbre obtenu : identique à
    # celui de HEAD, la PR ne changerait rien non plus.
    elif tree=$(git merge-tree --write-tree HEAD "upstream/pr/$num" 2>/dev/null); then
      if [ "$tree" = "$HEAD_TREE" ]; then state="deja-dedans"; else state="propre"; fi
    else
      state="CONFLIT"
    fi
    printf "  #%-3s %-18s %-12s %s\n" "$num" "$author" "$state" "$title"
  done <<< "$OPEN"
fi

if [ "$MERGE" != true ]; then
  echo
  echo "Rien n'a été modifié. Relance avec --merge pour fusionner upstream/main."
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  echo
  echo "✗ Ton dossier de travail a des modifications non commitées."
  echo "  Commite-les ou mets-les de côté (git stash -u) avant de fusionner."
  exit 1
fi

if [ "$NEW" -eq 0 ]; then
  echo
  echo "✓ Déjà à jour, rien à fusionner."
  exit 0
fi

echo
echo "→ Fusion de upstream/main…"
if ! git merge --no-ff upstream/main -m "Rapatrier upstream/main"; then
  echo
  echo "✗ Conflits à résoudre à la main, puis : git commit"
  echo "  Pour tout annuler et revenir en arrière : git merge --abort"
  exit 1
fi

echo
echo "→ Tests…"
npm test
