import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { adminUpdateUser, adminResetPassword } from "@/backend/users.functions";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export interface EditableUser {
  id: string;
  name: string;
  email: string | null;
  enrollment_number: string | null;
  profile_type: "admin" | "institution" | "teacher" | "student";
  status: string;
  institution_id: string | null;
}

export function EditUserDialog({
  user, open, onOpenChange, onSaved,
}: {
  user: EditableUser | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const updateFn = useServerFn(adminUpdateUser);
  const resetFn = useServerFn(adminResetPassword);
  const [name, setName] = useState("");
  const [profileType, setProfileType] = useState<EditableUser["profile_type"]>("student");
  const [status, setStatus] = useState<string>("active");
  const [institutionId, setInstitutionId] = useState<string>("none");
  const [institutions, setInstitutions] = useState<{ id: string; name: string }[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.from("institutions").select("id,name").order("name");
      setInstitutions(Array.isArray(data) ? data : []);
    })();
  }, [open]);

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setProfileType(user.profile_type);
      setStatus(user.status);
      setInstitutionId(user.institution_id ?? "none");
      setNewPassword("");
    }
  }, [user]);

  if (!user) return null;

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({ data: {
        user_id: user.id,
        name: name.trim() || undefined,
        status: status as "active" | "inactive" | "pending",
        profile_type: profileType,
        institution_id: institutionId === "none" ? null : institutionId,
      }});
      if (newPassword.trim().length >= 6) {
        await resetFn({ data: { user_id: user.id, new_password: newPassword.trim() } });
      }
      toast.success("Usuário atualizado");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Perfil</Label>
              <Select value={profileType} onValueChange={(v) => setProfileType(v as EditableUser["profile_type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="institution">Instituição</SelectItem>
                  <SelectItem value="teacher">Professor</SelectItem>
                  <SelectItem value="student">Estudante</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Instituição vinculada</Label>
            <Select value={institutionId} onValueChange={setInstitutionId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem vínculo</SelectItem>
                {institutions.map((i) => (
                  <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Nova senha (opcional)</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Deixe vazio para não alterar" />
            <p className="text-xs text-muted-foreground">Mínimo 6 caracteres.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}