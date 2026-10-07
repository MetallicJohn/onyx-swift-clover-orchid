"""
Seed Foundation data: Permissions, Roles, Platform Superadmin, and first Tenant (IMANI).

Idempotent — safe to run multiple times.
Usage:
    python manage.py seed_foundation
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.text import slugify

from identity.models import User, Permission, Role, UserRole
from tenants.models import Tenant, TenantSettings


# ---------------------------------------------------------------------------
# Permissions catalogue
# ---------------------------------------------------------------------------
PERMISSIONS = [
    # Customers
    ("customers.view", "View customers", "customers"),
    ("customers.create", "Create customers", "customers"),
    ("customers.edit", "Edit customers", "customers"),
    ("customers.delete", "Delete customers", "customers"),
    ("customers.export", "Export customers", "customers"),
    ("customers.import", "Import customers", "customers"),
    # Billing
    ("billing.view", "View billing", "billing"),
    ("billing.create_invoice", "Create invoices", "billing"),
    ("billing.adjust", "Adjust billing", "billing"),
    ("billing.refund", "Refund payments", "billing"),
    ("billing.void", "Void invoices", "billing"),
    ("billing.view_ledger", "View customer ledger", "billing"),
    # Services
    ("services.view", "View services", "services"),
    ("services.create", "Create services", "services"),
    ("services.edit", "Edit services", "services"),
    ("services.suspend", "Suspend services", "services"),
    ("services.restore", "Restore services", "services"),
    ("services.terminate", "Terminate services", "services"),
    # Routers / MikroTik
    ("routers.view", "View routers", "routers"),
    ("routers.create", "Create routers", "routers"),
    ("routers.edit", "Edit routers", "routers"),
    ("routers.configure", "Configure routers", "routers"),
    ("routers.restart", "Restart routers", "routers"),
    ("routers.delete", "Delete routers", "routers"),
    # RADIUS
    ("radius.view", "View RADIUS", "radius"),
    ("radius.manage_users", "Manage RADIUS users", "radius"),
    ("radius.disconnect", "Disconnect RADIUS sessions", "radius"),
    # Tickets
    ("tickets.view", "View tickets", "tickets"),
    ("tickets.create", "Create tickets", "tickets"),
    ("tickets.assign", "Assign tickets", "tickets"),
    ("tickets.close", "Close tickets", "tickets"),
    ("tickets.view_internal_notes", "View internal ticket notes", "tickets"),
    # Resellers
    ("resellers.view", "View resellers", "resellers"),
    ("resellers.manage", "Manage resellers", "resellers"),
    ("resellers.wallet", "Manage reseller wallet", "resellers"),
    # Reports
    ("reports.view", "View reports", "reports"),
    # Platform
    ("platform.tenants.manage", "Manage tenants", "platform"),
    ("platform.plans.manage", "Manage SaaS plans", "platform"),
    ("platform.audit.view", "View platform audit logs", "platform"),
    ("platform.settings.manage", "Manage platform settings", "platform"),
]


# ---------------------------------------------------------------------------
# System Roles
# ---------------------------------------------------------------------------
ROLES = [
    # Platform
    {
        "code": "platform_superadmin",
        "name": "Platform Superadmin",
        "scope": Role.Scope.PLATFORM,
        "permissions": [p[0] for p in PERMISSIONS],  # all
    },
    {
        "code": "platform_support",
        "name": "Platform Support",
        "scope": Role.Scope.PLATFORM,
        "permissions": [
            "platform.tenants.manage",
            "platform.audit.view",
            "customers.view",
            "tickets.view",
        ],
    },
    # Tenant
    {
        "code": "isp_owner",
        "name": "ISP Owner",
        "scope": Role.Scope.TENANT,
        "permissions": [p[0] for p in PERMISSIONS if not p[0].startswith("platform.")],
    },
    {
        "code": "isp_admin",
        "name": "ISP Administrator",
        "scope": Role.Scope.TENANT,
        "permissions": [p[0] for p in PERMISSIONS if not p[0].startswith("platform.")],
    },
    {
        "code": "finance",
        "name": "Finance",
        "scope": Role.Scope.TENANT,
        "permissions": [
            "customers.view",
            "billing.view",
            "billing.create_invoice",
            "billing.adjust",
            "billing.refund",
            "billing.void",
            "billing.view_ledger",
            "reports.view",
            "services.view",
        ],
    },
    {
        "code": "customer_care",
        "name": "Customer Care",
        "scope": Role.Scope.TENANT,
        "permissions": [
            "customers.view",
            "customers.create",
            "customers.edit",
            "services.view",
            "services.suspend",
            "services.restore",
            "tickets.view",
            "tickets.create",
            "tickets.assign",
            "tickets.close",
            "billing.view",
        ],
    },
    {
        "code": "network_engineer",
        "name": "Network Engineer",
        "scope": Role.Scope.TENANT,
        "permissions": [
            "routers.view",
            "routers.create",
            "routers.edit",
            "routers.configure",
            "routers.restart",
            "radius.view",
            "radius.manage_users",
            "radius.disconnect",
            "services.view",
            "customers.view",
        ],
    },
    {
        "code": "technician",
        "name": "Technician",
        "scope": Role.Scope.TENANT,
        "permissions": [
            "tickets.view",
            "tickets.create",
            "customers.view",
            "services.view",
        ],
    },
    {
        "code": "reseller",
        "name": "Reseller",
        "scope": Role.Scope.TENANT,
        "permissions": [
            "customers.view",
            "customers.create",
            "services.view",
            "services.create",
            "resellers.wallet",
            "reports.view",
        ],
    },
    {
        "code": "customer",
        "name": "Customer (self-service)",
        "scope": Role.Scope.TENANT,
        "permissions": [],  # object-level only
    },
]


class Command(BaseCommand):
    help = "Seed Foundation data (permissions, roles, platform admin, first tenant)"

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write("Seeding Foundation data...")

        # 1. Permissions
        perm_map = {}
        for code, name, category in PERMISSIONS:
            perm, created = Permission.objects.get_or_create(
                code=code,
                defaults={"name": name, "category": category},
            )
            perm_map[code] = perm
            status = "created" if created else "exists"
            self.stdout.write(f"  Permission {code}: {status}")

        # 2. Roles
        role_map = {}
        for role_def in ROLES:
            role, created = Role.objects.get_or_create(
                code=role_def["code"],
                scope=role_def["scope"],
                defaults={
                    "name": role_def["name"],
                    "is_system": True,
                },
            )
            # Sync permissions
            desired = [perm_map[c] for c in role_def["permissions"] if c in perm_map]
            role.permissions.set(desired)
            role_map[role_def["code"]] = role
            status = "created" if created else "updated"
            self.stdout.write(f"  Role {role_def['code']}: {status}")

        # 3. Platform Superadmin
        admin_email = "admin@platform.local"
        admin, created = User.objects.get_or_create(
            email=admin_email,
            defaults={
                "first_name": "Platform",
                "last_name": "Admin",
                "is_platform_user": True,
                "is_staff": True,
                "is_superuser": True,
                "is_active": True,
            },
        )
        if created:
            admin.set_password("ChangeMeNow123!")
            admin.save()
            self.stdout.write(self.style.SUCCESS(f"  Platform Superadmin created: {admin_email} / ChangeMeNow123!"))
        else:
            self.stdout.write(f"  Platform Superadmin already exists: {admin_email}")

        # Assign platform_superadmin role
        UserRole.objects.get_or_create(
            user=admin,
            role=role_map["platform_superadmin"],
            tenant=None,
        )

        # 4. First Tenant — IMANI NETWORKS LIMITED (data only, no hard-coded logic)
        tenant, created = Tenant.objects.get_or_create(
            slug="imani-networks",
            defaults={
                "name": "IMANI NETWORKS LIMITED",
                "status": Tenant.Status.TRIAL,
                "is_active": True,
                "support_email": "support@imani.example",
                "support_phone": "+254700000000",
            },
        )
        if created:
            TenantSettings.objects.create(
                tenant=tenant,
                timezone="Africa/Nairobi",
                currency="KES",
            )
            self.stdout.write(self.style.SUCCESS(f"  Tenant created: {tenant.name}"))
        else:
            self.stdout.write(f"  Tenant already exists: {tenant.name}")

        # 5. Demo ISP Owner under IMANI
        owner_email = "owner@imani.example"
        owner, created = User.objects.get_or_create(
            email=owner_email,
            defaults={
                "first_name": "IMANI",
                "last_name": "Owner",
                "is_platform_user": False,
                "is_active": True,
            },
        )
        if created:
            owner.set_password("ChangeMeNow123!")
            owner.save()
            self.stdout.write(self.style.SUCCESS(f"  ISP Owner created: {owner_email} / ChangeMeNow123!"))
        else:
            self.stdout.write(f"  ISP Owner already exists: {owner_email}")

        UserRole.objects.get_or_create(
            user=owner,
            role=role_map["isp_owner"],
            tenant=tenant,
        )

        self.stdout.write(self.style.SUCCESS("\nFoundation seed completed successfully."))
        self.stdout.write("Default passwords are temporary — change them immediately.")
