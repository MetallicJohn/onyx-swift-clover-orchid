"""
Identity & RBAC models - Foundation.
"""

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from common.models import TimeStampedModel, UUIDModel


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Users must have an email address")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_platform_user", True)
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin, UUIDModel, TimeStampedModel):
    """
    Custom user model supporting both Platform and Tenant users.
    """
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=30, blank=True)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # Django admin access
    is_platform_user = models.BooleanField(
        default=False,
        help_text="True for platform administrators. Tenant users are False."
    )

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        ordering = ["email"]

    def __str__(self):
        return self.email

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip() or self.email


class Permission(UUIDModel, TimeStampedModel):
    """Atomic permission, e.g. customers.view"""
    code = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=50, blank=True)

    class Meta:
        ordering = ["category", "code"]

    def __str__(self):
        return self.code


class Role(UUIDModel, TimeStampedModel):
    """Named collection of permissions."""
    class Scope(models.TextChoices):
        PLATFORM = "platform", "Platform"
        TENANT = "tenant", "Tenant"

    code = models.CharField(max_length=50)
    name = models.CharField(max_length=100)
    scope = models.CharField(max_length=20, choices=Scope.choices)
    description = models.TextField(blank=True)
    is_system = models.BooleanField(default=True, help_text="System roles cannot be deleted")
    permissions = models.ManyToManyField(Permission, blank=True, related_name="roles")

    class Meta:
        unique_together = [["code", "scope"]]
        ordering = ["scope", "code"]

    def __str__(self):
        return f"{self.scope}:{self.code}"


class UserRole(UUIDModel, TimeStampedModel):
    """
    Assignment of a Role to a User, optionally scoped to a Tenant.
    Platform roles have tenant=NULL.
    """
    user = models.ForeignKey("identity.User", on_delete=models.CASCADE, related_name="user_roles")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="user_roles")
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="user_roles",
        help_text="NULL for platform-scoped roles"
    )

    class Meta:
        unique_together = [["user", "role", "tenant"]]
        indexes = [
            models.Index(fields=["user", "tenant"]),
        ]

    def __str__(self):
        tenant_str = self.tenant.slug if self.tenant else "platform"
        return f"{self.user.email} → {self.role.code} ({tenant_str})"
