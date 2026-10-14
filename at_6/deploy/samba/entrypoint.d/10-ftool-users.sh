#!/bin/sh
set -eu

PASS='Fidev01!'
SAM=/var/lib/samba/private/sam.ldb

exists_user() { samba-tool user list 2>/dev/null | grep -qx "$1"; }
exists_group() { samba-tool group list 2>/dev/null | grep -qx "$1"; }

set_attrs() {
  dn=$(samba-tool user show "$1" | sed -n 's/^dn: //p')
  ldbmodify -H "$SAM" >/dev/null <<EOF
dn: $dn
changetype: modify
replace: displayName
displayName: $2
-
replace: employeeID
employeeID: $3
EOF
  echo "created user $1 ($dn)"
}

user() {
  if exists_user "$1"; then
    return
  fi
  if [ "$3" = "-" ]; then
    samba-tool user create "$1" "$PASS" --given-name="$2" \
      --mail-address="$6" --description="F-tool dev user" >/dev/null
  else
    samba-tool user create "$1" "$PASS" --given-name="$2" --surname="$3" \
      --mail-address="$6" --description="F-tool dev user" >/dev/null
  fi
  samba-tool user setexpiry "$1" --noexpiry >/dev/null
  set_attrs "$1" "$4" "$5"
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

user local  local  -      'local'       00001 local@example.local
user suzuki Jiro   Suzuki 'Jiro Suzuki' 00002 suzuki@example.local
user sato   Hanako Sato   'Hanako Sato' 00003 sato@example.local

group ft-maintainers 'F-tool dev: maintainer persona'
group ft-users       'F-tool dev: user persona'
samba-tool group addmembers ft-maintainers suzuki >/dev/null 2>&1 || true
samba-tool group addmembers ft-users sato >/dev/null 2>&1 || true

echo "ftool dev users ready"
