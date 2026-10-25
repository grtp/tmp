#!/bin/sh
set -eu

PASS='Fidev01!'
SAM=/var/lib/samba/private/sam.ldb
DATA=/data/ftool
LIST=$DATA/ftool-users.tsv
EXTRA=$DATA/ftool-users-extra.tsv
TAB="$(printf '\t')"

exists_user() { samba-tool user list 2>/dev/null | grep -qx "$1"; }
exists_group() { samba-tool group list 2>/dev/null | grep -qx "$1"; }

b64() { printf '%s' "$1" | base64 | tr -d '\n'; }

set_attrs() {
  dn=$(samba-tool user show "$1" | sed -n 's/^dn: //p')
  ldbmodify -H "$SAM" >/dev/null <<EOF
dn: $dn
changetype: modify
replace: displayName
displayName:: $(b64 "$2")
-
replace: employeeID
employeeID: $3
-
replace: department
department:: $(b64 "$4")
-
replace: title
title:: $(b64 "$5")
-
replace: description
description:: $(b64 "$6")
EOF
}

user() {
  if ! exists_user "$1"; then
    if [ "$3" = "-" ]; then
      samba-tool user create "$1" "$PASS" --given-name="$2" \
        --mail-address="$6" --description="F-tool dev user" >/dev/null
    else
      samba-tool user create "$1" "$PASS" --given-name="$2" --surname="$3" \
        --mail-address="$6" --description="F-tool dev user" >/dev/null
    fi
    samba-tool user setexpiry "$1" --noexpiry >/dev/null
    echo "created user $1"
  fi
  set_attrs "$1" "$4" "$5" "$7" "$8" "$9"
}

group() {
  if ! exists_group "$1"; then
    samba-tool group add "$1" --description="$2" >/dev/null
    echo "created group $1"
  fi
}

samba-tool domain passwordsettings set --max-pwd-age=0 >/dev/null

if ! exists_user svc-ldap; then
  samba-tool user create svc-ldap "$PASS" --description="F-tool LDAP service account" >/dev/null
  samba-tool user setexpiry svc-ldap --noexpiry >/dev/null
  echo "created user svc-ldap"
fi

rows() { tr -d '\r' < "$1" | grep -v '^#' | grep -v '^$'; }
rows "$LIST" | while IFS="$TAB" read -r sam given surname display empno mail dept title desc; do
  user "$sam" "$given" "$surname" "$display" "$empno" "$mail" "$dept" "$title" "$desc"
done

if [ -f "$EXTRA" ]; then
  rows "$EXTRA" | while IFS="$TAB" read -r sam given surname display empno mail dept title desc flags; do
    user "$sam" "$given" "$surname" "$display" "$empno" "$mail" "$dept" "$title" "$desc"
    if [ "$flags" = "disabled" ]; then
      samba-tool user disable "$sam" >/dev/null
    else
      samba-tool user enable "$sam" >/dev/null
    fi
  done
fi

group ft-maintainers 'F-tool dev: maintainer persona'
group ft-users       'F-tool dev: user persona'
samba-tool group addmembers ft-maintainers suzuki >/dev/null 2>&1 || true
samba-tool group addmembers ft-users sato >/dev/null 2>&1 || true

echo "ftool dev users ready"
