"""
Audit logging - Foundation.
"""

from django.db import models
from common.models import TimeStampedModel, UUIDModel


class AuditLog(UUIDModel, TimeStampedModel):
    """
    Append-only audit trail for sensitive actions.
    """
    actor = models.ForeignKey(
        "identity.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs"
    )
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs"
    )
    action = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=100, blank=True)
    entity_id = models.CharField(max_length=64, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    result = models.CharField(max_length=20, default="success")  # success / failure

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "-created_at"]),
            models.Index(fields=["actor", "-created_at"]),
            models.Index(fields=["action"]),
        ]

    def __str__(self):
        return f"{self.action} by {self.actor} at {self.created_at}"
