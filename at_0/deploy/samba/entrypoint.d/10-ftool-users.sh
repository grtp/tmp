#!/bin/sh
set -eu

PASS='Fidev01!'
SAM=/var/lib/samba/private/sam.ldb
DATA=/data/ftool
LIST=$DATA/ftool-users.tsv
EXTRA=$DATA/ftool-users-extra.tsv
MARK=/var/lib/samba/ftool-seed.sha256
TAB="$(printf '\t')"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

SUM=$(cat "$0" "$LIST" "$EXTRA" 2>/dev/null | sha256sum | cut -d' ' -f1)
if [ -f "$MARK" ] && [ "$(cat "$MARK")" = "$SUM" ]; then
  echo "ftool dev users unchanged (skip)"
  echo "ftool dev users ready"
  exit 0
fi

fetch_existing() {
  ldbsearch -H "$SAM" '(&(objectClass=user)(sAMAccountName=*))' sAMAccountName userAccountControl \
    | awk '/^ /{printf "%s", substr($0, 2); next} {printf "\n%s", $0} END{print ""}' \
    | awk '/^dn: /{dn=substr($0, 5)} /^sAMAccountName: /{sam=$2} /^userAccountControl: /{uac=$2}
           /^$/{if(sam!="")print sam "\t" uac "\t" dn; sam=""; uac=""; dn=""} END{if(sam!="")print sam "\t" uac "\t" dn}' \
    > "$WORK/existing.tsv"
}
fetch_existing
exists_user() { cut -f1 "$WORK/existing.tsv" | grep -qx "$1"; }
exists_group() { samba-tool group list 2>/dev/null | grep -qx "$1"; }
uac_of() { awk -F"$TAB" -v s="$1" '$1==s{print $2; exit}' "$WORK/existing.tsv"; }
dn_of() { awk -F"$TAB" -v s="$1" '$1==s{print $3; exit}' "$WORK/existing.tsv"; }

b64() { printf '%s' "$1" | base64 | tr -d '\n'; }

queue_attrs() {
  {
    echo "dn: $(dn_of "$1")"
    echo "changetype: modify"
    echo "replace: displayName"
    echo "displayName:: $(b64 "$2")"
    echo "-"
    echo "replace: employeeID"
    echo "employeeID: $3"
    echo "-"
    echo "replace: department"
    echo "department:: $(b64 "$4")"
    echo "-"
    echo "replace: title"
    echo "title:: $(b64 "$5")"
    echo "-"
    echo "replace: description"
    echo "description:: $(b64 "$6")"
    if [ -n "${7:-}" ]; then
      echo "-"
      echo "replace: userAccountControl"
      echo "userAccountControl: $7"
    fi
    echo ""
  } >> "$WORK/attrs.ldif"
}

create_user() {
  exists_user "$1" && return 0
  if [ "$3" = "-" ]; then
    samba-tool user create "$1" "$PASS" --given-name="$2" \
      --mail-address="$4" --description="F-tool dev user" >/dev/null
  else
    samba-tool user create "$1" "$PASS" --given-name="$2" --surname="$3" \
      --mail-address="$4" --description="F-tool dev user" >/dev/null
  fi
  samba-tool user setexpiry "$1" --noexpiry >/dev/null
  echo "created user $1"
  echo "$1" >> "$WORK/created"
}

user() {
  queue_attrs "$1" "$4" "$5" "$7" "$8" "$9" "${10:-}"
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
all_rows() { rows "$LIST"; [ -f "$EXTRA" ] && rows "$EXTRA"; return 0; }

: > "$WORK/created"
all_rows | while IFS="$TAB" read -r sam given surname display empno mail dept title desc flags; do
  create_user "$sam" "$given" "$surname" "$mail"
done
[ -s "$WORK/created" ] && fetch_existing

: > "$WORK/attrs.ldif"
rows "$LIST" | while IFS="$TAB" read -r sam given surname display empno mail dept title desc; do
  user "$sam" "$given" "$surname" "$display" "$empno" "$mail" "$dept" "$title" "$desc"
done
if [ -f "$EXTRA" ]; then
  rows "$EXTRA" | while IFS="$TAB" read -r sam given surname display empno mail dept title desc flags; do
    uac=$(uac_of "$sam")
    if [ "$flags" = "disabled" ]; then
      uac=$((uac | 2))
    else
      uac=$((uac & ~2))
    fi
    user "$sam" "$given" "$surname" "$display" "$empno" "$mail" "$dept" "$title" "$desc" "$uac"
  done
fi

ldbmodify -H "$SAM" "$WORK/attrs.ldif" >/dev/null
echo "updated attributes: $(grep -c '^dn: ' "$WORK/attrs.ldif") users"

group ft-maintainers 'F-tool dev: maintainer persona'
group ft-users       'F-tool dev: user persona'
samba-tool group addmembers ft-maintainers suzuki >/dev/null 2>&1 || true
samba-tool group addmembers ft-users sato >/dev/null 2>&1 || true

printf '%s' "$SUM" > "$MARK"
echo "ftool dev users ready"
