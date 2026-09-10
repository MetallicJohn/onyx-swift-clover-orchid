from django.contrib import admin
from .models import Tenant, TenantSettings

@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "status", "is_active", "created_at")
    list_filter = ("status", "is_active")
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}

@admin.register(TenantSettings)
class TenantSettingsAdmin(admin.ModelAdmin):
    list_display = ("tenant", "timezone", "currency")
