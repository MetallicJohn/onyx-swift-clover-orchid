from django.contrib import admin
from .models import AuditLog

@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "actor", "tenant", "entity_type", "result", "created_at")
    list_filter = ("action", "result", "created_at")
    search_fields = ("action", "entity_id", "actor__email")
    readonly_fields = ("id", "created_at", "updated_at")
