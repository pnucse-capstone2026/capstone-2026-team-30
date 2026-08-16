import { notFound } from "next/navigation";

import { PolicyForm } from "@/app/admin/policies/policy-form";
import { kyvernoPolicies } from "@/lib/policies";

type AdminPolicyEditPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export function generateStaticParams() {
  return kyvernoPolicies.map((policy) => ({
    id: policy.id,
  }));
}

export default async function AdminPolicyEditPage({
  params,
}: AdminPolicyEditPageProps) {
  const { id } = await params;
  const policy = kyvernoPolicies.find((item) => item.id === id);

  if (!policy) {
    notFound();
  }

  return <PolicyForm mode="edit" policy={policy} />;
}
