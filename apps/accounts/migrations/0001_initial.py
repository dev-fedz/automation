from django.db import migrations, models
import django.utils.timezone
from django.conf import settings
from apps.accounts.models import uploaded_file_path


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('auth', '0012_alter_user_first_name_max_length'),
        ('contenttypes', '0002_remove_content_type_name'),
    ]

    operations = [
        migrations.CreateModel(
            name='User',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('password', models.CharField(max_length=128, verbose_name='password')),
                ('last_login', models.DateTimeField(blank=True, null=True, verbose_name='last login')),
                ('is_superuser', models.BooleanField(default=False, help_text='Designates that this user has all permissions without explicitly assigning them.', verbose_name='superuser status')),
                ('username', models.CharField(error_messages={'unique': 'A user with that username already exists.'}, help_text='Required. 150 characters or fewer. Letters, digits and @/./+/-/_ only.', max_length=150, unique=True, verbose_name='username')),
                ('first_name', models.CharField(blank=True, max_length=150, verbose_name='first name')),
                ('last_name', models.CharField(blank=True, max_length=150, verbose_name='last name')),
                ('email', models.EmailField(blank=True, max_length=254, verbose_name='email address')),
                ('is_staff', models.BooleanField(default=False, help_text='Designates whether the user can log into this admin site.', verbose_name='staff status')),
                ('is_active', models.BooleanField(default=True, help_text='Designates whether this user should be treated as active. Unselect this instead of deleting accounts.', verbose_name='active')),
                ('date_joined', models.DateTimeField(default=django.utils.timezone.now, verbose_name='date joined')),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, default=None, null=True)),
                ('status', models.CharField(choices=[('L', 'Locked'), ('U', 'Unlocked')], default='U', max_length=5)),
                ('is_temporary', models.BooleanField(default=False)),
                ('otp', models.CharField(blank=True, max_length=20, null=True)),
                ('login_attempt', models.IntegerField(default=0)),
                ('mobile_no', models.CharField(blank=True, max_length=150, null=True)),
                ('birthdate', models.DateField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True, db_index=True)),
                ('type', models.CharField(choices=[('A', 'Admin'), ('G', 'Guest'), ('N', 'None')], default='N', max_length=5)),
                ('groups', models.ManyToManyField(blank=True, help_text='The groups this user belongs to.', related_name='user_set', related_query_name='user', to='auth.group', verbose_name='groups')),
                ('user_permissions', models.ManyToManyField(blank=True, help_text='Specific permissions for this user.', related_name='user_set', related_query_name='user', to='auth.permission', verbose_name='user permissions')),
            ],
            options={'abstract': False},
        ),
        migrations.CreateModel(
            name='Module',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255)),
                ('description', models.TextField(blank=True, null=True)),
                ('codename', models.CharField(max_length=255)),
                ('category', models.CharField(choices=[('B', 'Base'), ('DB', 'Dashboard'), ('UM', 'User Management'), ('CORE', 'Core'), ('CMS', 'CMS'), ('R', 'Reports')], default='B', max_length=5)),
                ('order', models.IntegerField(default=0)),
            ],
        ),
        migrations.CreateModel(
            name='Assets',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=150)),
                ('url', models.FileField(upload_to=uploaded_file_path)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.CreateModel(
            name='RoleModule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('module', models.ForeignKey(on_delete=models.deletion.CASCADE, to='accounts.module')),
                ('role', models.ForeignKey(on_delete=models.deletion.CASCADE, to='auth.group')),
            ],
        ),
        migrations.CreateModel(
            name='ModulePermission',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('label', models.CharField(max_length=150)),
                ('module', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='permissions', to='accounts.module')),
                ('permission', models.ForeignKey(null=True, on_delete=models.deletion.CASCADE, related_name='modules', to='auth.permission')),
            ],
        ),
        migrations.AddField(
            model_name='module',
            name='roles',
            field=models.ManyToManyField(related_name='modules', through='accounts.RoleModule', to='auth.group'),
        ),
        migrations.AddField(
            model_name='rolemodule',
            name='permissions',
            field=models.ManyToManyField(to='auth.permission'),
        ),
    ]
