from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, Permission, Role, UserRole

@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("email", "first_name", "last_name", "is_platform_user", "is_active", "is_staff")
    list_filter = ("is_platform_user", "is_active", "is_staff")
    search_fields = ("email", "first_name", "last_name")
    ordering = ("email",)
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal", {"fields": ("first_name", "last_name", "phone")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "is_platform_user", "groups", "user_permissions")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "password1", "password2", "is_platform_user"),
        }),
    )

@admin.register(Permission)
class PermissionAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "category")
    list_filter = ("category",)
    search_fields = ("code", "name")

@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "scope", "is_system")
    list_filter = ("scope", "is_system")
    filter_horizontal = ("permissions",)

@admin.register(UserRole)
class UserRoleAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "tenant", "created_at")
    list_filter = ("role__scope",)
    raw_id_fields = ("user", "tenant")
