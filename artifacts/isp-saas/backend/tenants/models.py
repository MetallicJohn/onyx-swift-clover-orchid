"""
Tenant (ISP) models - Foundation multi-tenancy.
"""

from django.db import models
from common.models import TimeStampedModel, UUIDModel


class Tenant(UUIDModel, TimeStampedModel):
    """
    Represents an ISP / organization on the platform.
    IMANI NETWORKS LIMITED will be the first tenant, but nothing is hard-coded to it.
    """

    class Status(models.TextChoices):
        TRIAL = "trial", "Trial"
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"
        CANCELLED = "cancelled", "Cancelled"

    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=100, unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TRIAL)
    trial_ends_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    # Branding (tenant-configurable)
    logo_url = models.URLField(blank=True)
    primary_color = models.CharField(max_length=7, blank=True, help_text="Hex color")

    # Contact
    support_email = models.EmailField(blank=True)
    support_phone = models.CharField(max_length=30, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Tenant"
        verbose_name_plural = "Tenants"

    def __str__(self):
        return self.name


class TenantSettings(TimeStampedModel):
    """Key-value or structured settings per tenant."""
    tenant = models.OneToOneField(Tenant, on_delete=models.CASCADE, related_name="settings")
    timezone = models.CharField(max_length=50, default="Africa/Nairobi")
    currency = models.CharField(max_length=3, default="KES")
    # Feature flags can also live here later
    extra = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"Settings for {self.tenant.name}"
