"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import type { Member, SharingServices } from "@/lib/board/services";
import {
  InvitationsSection,
  InviteSection,
  JoinRequestsSection,
  MembersSection,
  SharingSection,
} from "./sharing/sharing-sections";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  services: SharingServices & { loadMembers(): Promise<Member[]> };
  currentUserId: string;
  boardTitle: string;
  onChanged: () => void;
}

const TABS = [
  { id: "invite", label: "Invite" },
  { id: "members", label: "Members" },
  { id: "sharing", label: "Link and code" },
  { id: "requests", label: "Requests" },
];

/** Owner-only: everything about who can reach this board. */
export function ShareDialog({ open, onClose, services, currentUserId, boardTitle, onChanged }: ShareDialogProps) {
  const [tab, setTab] = useState("invite");
  const [invitationsKey, setInvitationsKey] = useState(0);

  return (
    <Modal open={open} onClose={onClose} title={`Share “${boardTitle}”`} size="lg">
      <Tabs label="Sharing" tabs={TABS} value={tab} onChange={setTab} panelClassName="pt-6">
        {tab === "invite" ? (
          <div className="flex flex-col gap-8">
            <InviteSection
              services={services}
              onChanged={() => {
                setInvitationsKey((value) => value + 1);
                onChanged();
              }}
            />
            <div>
              <h3 className="mb-3 text-sm font-medium">Invitations</h3>
              <InvitationsSection key={invitationsKey} services={services} onChanged={onChanged} />
            </div>
          </div>
        ) : null}
        {tab === "members" ? (
          <MembersSection services={services} currentUserId={currentUserId} onChanged={onChanged} />
        ) : null}
        {tab === "sharing" ? <SharingSection services={services} onChanged={onChanged} /> : null}
        {tab === "requests" ? <JoinRequestsSection services={services} onChanged={onChanged} /> : null}
      </Tabs>
    </Modal>
  );
}
